# Generated type-sharing pipeline

The files under `./generated/` are produced by `scripts/generate-types.sh`
from Rust `serde` structs in `crates/tmai-core/`. Do **not** hand-edit them —
update the Rust source and regenerate.

## What lives where

- `generated/*.ts` — TypeScript types derived by [`ts-rs`](https://github.com/Aleph-Alpha/ts-rs) from Rust types carrying `#[derive(TS)]`.
- `generated/openapi.json` — OpenAPI 3 document derived by [`utoipa`](https://github.com/juhaku/utoipa).
- `index.ts` — barrel re-exports for consumers.
- `sse-event.ts` — typed narrower that turns the untyped `SSEHandlers.onEvent` payload into a discriminated `CoreEvent`.

## How to regenerate

```sh
bash scripts/generate-types.sh
git add crates/tmai-app/web/src/types/generated/
```

CI's `types-drift` job re-runs the script and fails the build if the committed
files differ from a fresh regeneration.

## Adding a new type to the pipeline

1. On the Rust struct or enum, add:

   ```rust
   #[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
   #[cfg_attr(
       feature = "ts-export",
       ts(export, export_to = "../../tmai-app/web/src/types/generated/")
   )]
   #[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
   ```

2. For enums that rename variants via `#[serde(rename_all = "...")]`, mirror
   the setting on `ts(..., rename_all = "...")` so the TS tags stay in sync.

3. Run `bash scripts/generate-types.sh` and commit the diff under `generated/`.

4. Import the generated type via the barrel:

   ```ts
   import type { TaskMetaEntry } from "@/types";
   ```

See issue [#446](https://github.com/trust-delta/tmai/issues/446) for the
PoC rationale and the migration plan for the remaining ~80 endpoints.
