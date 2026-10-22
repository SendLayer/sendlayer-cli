#!/usr/bin/env bash
# Build native binaries via Bun --compile.
# Run after `npm run build` so dist/ is up to date.
#
# Usage: bash scripts/build-binaries.sh [version]
set -euo pipefail

VERSION="${1:-${npm_package_version:-0.0.0-dev}}"
OUT_DIR="dist-bin"

# NOT bin/run.js — that entry makes oclif locate the package on disk at runtime,
# which cannot work inside a compiled binary. See bin/binary.js for details.
ENTRY="bin/binary.js"

# Prefer the devDependency: its version is pinned by package-lock.json, so
# release builds are reproducible. A global bun is only a fallback.
if [ -x "./node_modules/.bin/bun" ]; then
  BUN="./node_modules/.bin/bun"
elif command -v bun >/dev/null 2>&1; then
  BUN="bun"
else
  echo "Bun is required. Run: npm install" >&2
  echo "   ...or install it globally: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
echo "Using bun $("$BUN" --version)"

if [ ! -f "dist/index.js" ] || [ ! -f "oclif.manifest.json" ]; then
  echo "dist/index.js and oclif.manifest.json are required. Run 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

declare -a TARGETS=(
  "linux x64    bun-linux-x64"
  "linux arm64  bun-linux-arm64"
  "darwin x64   bun-darwin-x64"
  "darwin arm64 bun-darwin-arm64"
  "windows x64  bun-windows-x64"
)

for spec in "${TARGETS[@]}"; do
  read -r OS ARCH BUN_TARGET <<< "$spec"
  STAGE="$OUT_DIR/stage_${OS}_${ARCH}"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"

  EXT=""
  if [ "$OS" = "windows" ]; then EXT=".exe"; fi

  echo "==> Building $OS/$ARCH ($BUN_TARGET)"
  "$BUN" build "$ENTRY" \
    --compile \
    --minify \
    --target="$BUN_TARGET" \
    --outfile "$STAGE/sendlayer$EXT"

  TARBALL="$OUT_DIR/sendlayer_${VERSION}_${OS}_${ARCH}.tar.gz"
  ZIP="$OUT_DIR/sendlayer_${VERSION}_${OS}_${ARCH}.zip"

  if [ "$OS" = "windows" ]; then
    (cd "$STAGE" && zip -q "../$(basename "$ZIP")" "sendlayer$EXT")
    echo "  -> $ZIP"
  else
    tar -czf "$TARBALL" -C "$STAGE" "sendlayer"
    echo "  -> $TARBALL"
  fi

  # Drop the uncompressed binary; each is ~65-100MB and only the archive ships.
  rm -rf "$STAGE"
done

echo "==> Generating SHA256SUMS"

# scripts/install.sh verifies every download against this file, so an empty or
# missing SHA256SUMS breaks installation for everyone. Fail the build instead.
# install.sh accepts either tool, so accept either here too.
if command -v shasum >/dev/null 2>&1; then
  SHA_CMD=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD=(sha256sum)
else
  echo "Need 'shasum' or 'sha256sum' to generate SHA256SUMS." >&2
  exit 1
fi

(cd "$OUT_DIR" && "${SHA_CMD[@]}" sendlayer_*.tar.gz sendlayer_*.zip > SHA256SUMS)

if [ ! -s "$OUT_DIR/SHA256SUMS" ]; then
  echo "SHA256SUMS is empty — refusing to ship unverifiable archives." >&2
  exit 1
fi

cat "$OUT_DIR/SHA256SUMS"
