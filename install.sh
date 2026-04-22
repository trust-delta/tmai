#!/usr/bin/env bash
# tmai installer
#
# Downloads the per-platform tmai bundle tarball from a GitHub Release,
# verifies sha256, and installs under --prefix (default: $HOME/.local):
#
#   $PREFIX/bin/tmai
#   $PREFIX/bin/tmai-ratatui
#   $PREFIX/share/tmai/webui/
#   $PREFIX/share/tmai/api-spec/
#
# tmai resolves the WebUI via the binary-relative fallback
# <exe>/../share/tmai/webui/, so the layout above works without extra env.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash -s -- --version 2.0.0
#   curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash -s -- --prefix ~/.local

set -euo pipefail

REPO="trust-delta/tmai"
PREFIX="${HOME}/.local"
VERSION=""

print_help() {
  cat <<'HELP'
tmai installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash -s -- [OPTIONS]

Options:
  --version X.Y.Z   Install a specific version (default: latest release).
  --prefix DIR      Install prefix (default: $HOME/.local).
                    Places bin/tmai, bin/tmai-ratatui, and
                    share/tmai/{webui,api-spec}/ under DIR.
  --help, -h        Show this message.

Supported platforms:
  Linux  x86_64  (x86_64-unknown-linux-gnu)
  Linux  aarch64 (aarch64-unknown-linux-gnu)
  macOS  arm64   (aarch64-apple-darwin)
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { echo "--version needs a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --prefix)
      [[ $# -ge 2 ]] || { echo "--prefix needs a value" >&2; exit 2; }
      PREFIX="$2"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}
need curl
need tar
need shasum

uname_s=$(uname -s)
uname_m=$(uname -m)
case "${uname_s}:${uname_m}" in
  Linux:x86_64)              target="x86_64-unknown-linux-gnu" ;;
  Linux:aarch64|Linux:arm64) target="aarch64-unknown-linux-gnu" ;;
  Darwin:arm64)              target="aarch64-apple-darwin" ;;
  *)
    echo "Unsupported platform: ${uname_s} ${uname_m}" >&2
    echo "Supported: Linux x86_64, Linux aarch64, macOS arm64." >&2
    exit 1
    ;;
esac

if [[ -z "${VERSION}" ]]; then
  echo "Resolving latest release tag..."
  VERSION=$(
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' \
      | head -n1
  )
  if [[ -z "${VERSION}" ]]; then
    echo "Failed to resolve latest release tag from ${REPO}." >&2
    exit 1
  fi
fi

archive="tmai-v${VERSION}-${target}.tar.gz"
base="https://github.com/${REPO}/releases/download/v${VERSION}"

tmp=$(mktemp -d)
trap 'rm -rf "${tmp}"' EXIT

echo "Downloading ${archive}..."
curl -fsSL "${base}/${archive}"        -o "${tmp}/${archive}"
curl -fsSL "${base}/${archive}.sha256" -o "${tmp}/${archive}.sha256"

echo "Verifying sha256..."
( cd "${tmp}" && shasum -c "${archive}.sha256" )

echo "Extracting..."
tar -xzf "${tmp}/${archive}" -C "${tmp}"
staging="${tmp}/tmai-v${VERSION}"

mkdir -p "${PREFIX}/bin" "${PREFIX}/share/tmai"
cp -f "${staging}/bin/tmai"          "${PREFIX}/bin/tmai"
cp -f "${staging}/bin/tmai-ratatui"  "${PREFIX}/bin/tmai-ratatui"
chmod +x "${PREFIX}/bin/tmai" "${PREFIX}/bin/tmai-ratatui"

rm -rf "${PREFIX}/share/tmai/webui" "${PREFIX}/share/tmai/api-spec"
cp -R "${staging}/share/tmai/webui"     "${PREFIX}/share/tmai/webui"
cp -R "${staging}/share/tmai/api-spec"  "${PREFIX}/share/tmai/api-spec"

echo
echo "tmai ${VERSION} installed at ${PREFIX}:"
echo "  bin/tmai"
echo "  bin/tmai-ratatui"
echo "  share/tmai/webui/"
echo "  share/tmai/api-spec/"
echo
case ":${PATH}:" in
  *":${PREFIX}/bin:"*) ;;
  *)
    echo "Reminder: add ${PREFIX}/bin to your PATH, e.g."
    echo "  echo 'export PATH=\"${PREFIX}/bin:\$PATH\"' >> ~/.bashrc"
    ;;
esac
