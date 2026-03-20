#!/usr/bin/env bash
# Quick dev build: React frontend → assets → cargo build (debug)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/crates/tmai-app/web"
ASSETS_DIR="$ROOT_DIR/src/web/assets"

# Build React frontend
echo "==> Building React frontend..."
cd "$WEB_DIR"
pnpm build

# Copy build output to assets directory
echo "==> Copying dist to assets..."
rm -rf "$ASSETS_DIR"
cp -r dist "$ASSETS_DIR"

# Build Rust binary (debug)
echo "==> Building Rust binary (debug)..."
cd "$ROOT_DIR"
cargo build

echo "==> Done! Run with: cargo run -- --web-only"
