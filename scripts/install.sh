#!/usr/bin/env bash
# SendLayer CLI installer.
#
# Usage:
#   curl -fsSL https://sendlayer.com/install.sh | bash
#   curl -fsSL https://sendlayer.com/install.sh | SENDLAYER_VERSION=v0.2.0 bash
#   curl -fsSL https://sendlayer.com/install.sh | SENDLAYER_INSTALL_DIR=$HOME/.local/bin bash

set -euo pipefail

REPO="${SENDLAYER_REPO:-SendLayer/sendlayer-cli}"
BIN_NAME="sendlayer"
INSTALL_DIR_DEFAULT="/usr/local/bin"
INSTALL_DIR="${SENDLAYER_INSTALL_DIR:-$INSTALL_DIR_DEFAULT}"

color() {
  if [ -t 1 ]; then printf '\033[%sm' "$1"; fi
}
reset() { color 0; }
info() { color 36; printf '%s\n' "$1"; reset; }
err() { color 31; printf '%s\n' "$1" >&2; reset; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; exit 1; }
}

require curl
require tar
if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
  err "Need 'shasum' or 'sha256sum' to verify downloads."
  exit 1
fi

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *) err "Unsupported OS: $OS_RAW. On Windows use 'irm https://sendlayer.com/install.ps1 | iex' or 'npm i -g sendlayer-cli'."; exit 1 ;;
esac

case "$ARCH_RAW" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) err "Unsupported architecture: $ARCH_RAW"; exit 1 ;;
esac

# Resolve version
if [ -n "${SENDLAYER_VERSION:-}" ]; then
  VERSION="$SENDLAYER_VERSION"
else
  info "Resolving latest version..."
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -nE 's/.*"tag_name": "([^"]+)".*/\1/p' | head -n1)"
fi
if [ -z "$VERSION" ]; then
  err "Could not resolve version (set SENDLAYER_VERSION=v0.X.Y to bypass)."
  exit 1
fi
info "Installing ${BIN_NAME} ${VERSION} for ${OS}-${ARCH}"

VERSION_BARE="${VERSION#v}"
ARCHIVE="sendlayer_${VERSION_BARE}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"
SUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info "Downloading ${URL}"
curl -fsSL "$URL" -o "$TMP/$ARCHIVE"
curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS"

info "Verifying checksum"
cd "$TMP"
if command -v shasum >/dev/null 2>&1; then
  grep " $ARCHIVE\$" SHA256SUMS | shasum -a 256 -c -
else
  grep " $ARCHIVE\$" SHA256SUMS | sha256sum -c -
fi

tar -xzf "$ARCHIVE"

# Pick install dir (fall back to ~/.local/bin if default is not writable)
TARGET_DIR="$INSTALL_DIR"
if ! mkdir -p "$TARGET_DIR" 2>/dev/null || [ ! -w "$TARGET_DIR" ]; then
  TARGET_DIR="$HOME/.local/bin"
  mkdir -p "$TARGET_DIR"
fi

install -m 755 "${BIN_NAME}" "$TARGET_DIR/${BIN_NAME}"
info "Installed to ${TARGET_DIR}/${BIN_NAME}"

if ! echo ":$PATH:" | grep -q ":${TARGET_DIR}:"; then
  err "Note: ${TARGET_DIR} is not on your PATH. Add this to your shell profile:"
  err "  export PATH=\"${TARGET_DIR}:\$PATH\""
fi

"${TARGET_DIR}/${BIN_NAME}" --version || true
