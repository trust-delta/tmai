#!/usr/bin/env bash
# Regenerate the type-sharing pipeline outputs under
# crates/tmai-app/web/src/types/generated/.
#
# Source of truth is Rust:
#   - ts-rs derives → *.ts (TypeScript bindings)
#   - utoipa OpenApi → openapi.json
#
# See .claude/decisions/2026-04-15-type-sharing-pipeline.md (#446) for the
# full rationale and migration plan. The CI job `types-drift` reruns this
# script and fails if git diff --exit-code shows uncommitted changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "==> Regenerating TypeScript bindings via ts-rs"
cargo test -p tmai-core --features ts-export --quiet export_bindings

echo "==> Regenerating openapi.json via utoipa"
TMAI_REGENERATE_OPENAPI=1 \
  cargo test -p tmai-core --features openapi --quiet regenerate_openapi_json

echo "==> Formatting generated TypeScript via biome"
# ts-rs emits terse one-liners; biome --write rewrites them to match the
# project's formatting rules so subsequent `biome check` is a no-op.
cd "${REPO_ROOT}/crates/tmai-app/web"
npx biome format --write src/types/generated/ >/dev/null

echo "==> Done. Generated files:"
ls -1 "${REPO_ROOT}/crates/tmai-app/web/src/types/generated/"
