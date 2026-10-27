#!/usr/bin/env bash
# Verify a compiled binary is genuinely self-contained.
#
# The failure this guards against: a binary that works on the machine that built
# it because it still resolves paths back into the build tree, then breaks for
# every user. Bun bakes build-time absolute paths into the output, so "it ran on
# my laptop" proves nothing on its own.
#
# Method: copy the project to a throwaway directory, build there, DELETE that
# directory, then run the binary. If it still works, nothing it needs lives
# outside the executable.
#
# Usage: bash scripts/verify-binary.sh
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
BUILD_COPY="$WORK/buildcopy"
BINARY="$WORK/sendlayer"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

BUN="bun"
if ! command -v bun >/dev/null 2>&1; then
  if [ -x "$PROJECT_ROOT/node_modules/.bin/bun" ]; then
    BUN="$PROJECT_ROOT/node_modules/.bin/bun"
  else
    echo "Bun is required. Run 'npm install' or install Bun globally." >&2
    exit 1
  fi
fi

# Match the host so the binary is runnable here.
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) echo "Run this on macOS or Linux (Windows binaries can't be executed here)." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
TARGET="bun-${OS}-${ARCH}"

echo "==> Copying project to a throwaway location"
mkdir -p "$BUILD_COPY"
# node_modules is needed to bundle; dist-bin and .git are not.
rsync -a --exclude dist-bin --exclude .git "$PROJECT_ROOT/" "$BUILD_COPY/"

if [ ! -f "$BUILD_COPY/dist/index.js" ] || [ ! -f "$BUILD_COPY/oclif.manifest.json" ]; then
  echo "dist/ and oclif.manifest.json are required. Run 'npm run build' first." >&2
  exit 1
fi

echo "==> Building from $BUILD_COPY ($TARGET)"
(cd "$BUILD_COPY" && "$BUN" build bin/binary.js \
  --compile --minify --target="$TARGET" --outfile "$BINARY" >/dev/null)

echo "==> Deleting the build tree"
rm -rf "$BUILD_COPY"
[ ! -d "$BUILD_COPY" ] || { echo "Failed to remove build tree" >&2; exit 1; }

echo "==> Running the binary with its build tree gone"
cd "$WORK"
chmod +x "$BINARY"

FAILED=0
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok   $label"
  else
    echo "  FAIL $label"
    FAILED=1
  fi
}

check "--version" "$BINARY" --version
check "--help" "$BINARY" --help

# Every command in the manifest must be reachable, not just the root help.
COMMANDS="login logout whoami emails:send events:list webhooks:create webhooks:delete webhooks:list webhooks:listen"
for id in $COMMANDS; do
  # shellcheck disable=SC2086 # intentional word splitting: 'emails:send' -> 'emails send'
  check "$id --help" "$BINARY" ${id//:/ } --help
done

echo
if [ "$FAILED" -ne 0 ]; then
  echo "FAILED: the binary depends on files outside itself." >&2
  exit 1
fi

echo "PASSED: binary is self-contained ($("$BINARY" --version))"
