#!/usr/bin/env bash
# Build React frontend and embed into Rust binary
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/crates/tmai-app/web"
ASSETS_DIR="$ROOT_DIR/src/web/assets"

# Build React frontend
echo "==> Building React frontend..."
cd "$WEB_DIR"
pnpm install --frozen-lockfile
pnpm build

# Copy build output to assets directory
echo "==> Copying dist to $ASSETS_DIR..."
rm -rf "$ASSETS_DIR"
cp -r dist "$ASSETS_DIR"

# Build Rust binary
echo "==> Building Rust binary..."
cd "$ROOT_DIR"
cargo build --release

echo "==> Done! Binary at target/release/tmai"
