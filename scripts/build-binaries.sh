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

BUN="bun"
if ! command -v bun >/dev/null 2>&1; then
  # Fall back to the devDependency so local builds work without a global install.
  if [ -x "./node_modules/.bin/bun" ]; then
    BUN="./node_modules/.bin/bun"
  else
    echo "Bun is required. Install: curl -fsSL https://bun.sh/install | bash" >&2
    echo "   ...or run: npm install" >&2
    exit 1
  fi
fi

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
(cd "$OUT_DIR" && shasum -a 256 sendlayer_*.tar.gz sendlayer_*.zip 2>/dev/null > SHA256SUMS || true)
cat "$OUT_DIR/SHA256SUMS"
