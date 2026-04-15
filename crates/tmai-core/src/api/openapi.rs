//! OpenAPI schema for the tmai Web API (PoC — #446).
//!
//! The `ApiDoc` struct below collects utoipa `ToSchema` impls and hand-written
//! `#[utoipa::path]` stubs into a single `utoipa::OpenApi` definition. The
//! `scripts/generate-types.sh` pipeline uses it to emit
//! `crates/tmai-app/web/src/types/generated/openapi.json`, which is the
//! machine-readable source for external clients and docs.
//!
//! Scope: for the PoC we document just `GET /api/task-meta`. The migration
//! plan (see `.claude/decisions/2026-04-15-type-sharing-pipeline.md`) covers
//! rolling this out to the rest of the ~80 endpoints.

use utoipa::OpenApi;

use crate::api::types::TaskMetaEntry;
use crate::task_meta::Milestone;

/// Root OpenAPI document for tmai.
///
/// Referenced schemas are re-exported as JSON-Schema components; path items
/// are defined by the `#[utoipa::path]` stubs below. The actual axum handler
/// for `/api/task-meta` lives in `src/web/api.rs`; keeping the doc stub in
/// `tmai-core` avoids pulling utoipa into the binary for the PoC and lets the
/// generated schema live with the type definitions it describes.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "tmai Web API",
        description = "Proof-of-concept OpenAPI document — see issue #446. \
                       The full API surface (~80 endpoints) is migrating incrementally.",
        version = env!("CARGO_PKG_VERSION")
    ),
    paths(get_task_meta_doc),
    components(schemas(TaskMetaEntry, Milestone)),
    tags(
        (name = "task-meta", description = "Project task metadata — merges git worktree info with `.task-meta/` JSON")
    )
)]
pub struct ApiDoc;

/// Documentation stub for `GET /api/task-meta`.
///
/// utoipa's path macro only needs a function *signature* to attach metadata;
/// the real handler is `crate::web::api::get_task_meta` in the binary crate.
/// A follow-up will adopt `utoipa-axum` so handler and doc share one source.
#[utoipa::path(
    get,
    path = "/api/task-meta",
    tag = "task-meta",
    responses(
        (status = 200, description = "Task metadata entries for the active project", body = Vec<TaskMetaEntry>)
    )
)]
#[allow(dead_code)]
fn get_task_meta_doc() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openapi_doc_has_task_meta_path_and_schemas() {
        let doc = ApiDoc::openapi();
        let paths = doc.paths.paths;
        assert!(
            paths.contains_key("/api/task-meta"),
            "expected /api/task-meta path in generated OpenAPI, got keys: {:?}",
            paths.keys().collect::<Vec<_>>()
        );
        let components = doc
            .components
            .expect("OpenAPI components should be present");
        assert!(
            components.schemas.contains_key("TaskMetaEntry"),
            "expected TaskMetaEntry schema"
        );
        assert!(
            components.schemas.contains_key("Milestone"),
            "expected Milestone schema"
        );
    }

    /// Regenerate the committed `openapi.json` under
    /// `crates/tmai-app/web/src/types/generated/`. Invoked by
    /// `scripts/generate-types.sh`; CI reruns it and fails on drift.
    ///
    /// Set `TMAI_REGENERATE_OPENAPI=1` to opt in — running this in ordinary
    /// `cargo test` would race with ts-rs export_bindings tests.
    #[test]
    fn regenerate_openapi_json() {
        if std::env::var_os("TMAI_REGENERATE_OPENAPI").is_none() {
            return;
        }
        let json = ApiDoc::openapi()
            .to_pretty_json()
            .expect("utoipa should serialize OpenAPI to JSON");
        let manifest = env!("CARGO_MANIFEST_DIR");
        let out = std::path::Path::new(manifest)
            .join("..")
            .join("tmai-app")
            .join("web")
            .join("src")
            .join("types")
            .join("generated")
            .join("openapi.json");
        std::fs::create_dir_all(out.parent().unwrap()).expect("create generated/ directory");
        std::fs::write(&out, json).expect("write openapi.json");
    }
}
