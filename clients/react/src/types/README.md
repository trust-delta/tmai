# Generated types

The files under `./generated/` mirror TypeScript types **published by
[tmai-api-spec](https://github.com/trust-delta/tmai-api-spec)**. They
originate from Rust `serde` structs in the private `tmai-core` repo, which
runs [`ts-rs`](https://github.com/Aleph-Alpha/ts-rs) and
[`utoipa`](https://github.com/juhaku/utoipa) internally and commits the
output into `tmai-api-spec`. `tmai-react` only consumes the result.

Do **not** hand-edit anything in `./generated/`.

## What lives where

- `generated/*.ts` — TypeScript types for every public payload (`CoreEvent`,
  `TaskMetaSnapshot`, `WorktreeInfo`, …).
- `generated/openapi.json` — OpenAPI 3 document for the REST surface.
- `index.ts` — barrel re-exports for consumers.
- `sse-event.ts` — typed narrower that turns the untyped `SSEHandlers.onEvent`
  payload into a discriminated `CoreEvent`.

## How to sync with tmai-api-spec

When `tmai-api-spec` publishes a new version, refresh this tree by copying
its distribution into `./generated/`:

1. Pull the latest `tmai-api-spec` (tag or main).
2. Replace the contents of `src/types/generated/` with the spec's published
   TypeScript output (including `openapi.json`).
3. If new top-level types were added, export them from `./index.ts`.
4. Run `pnpm lint && pnpm test` to confirm the UI still type-checks.

## Adding a new generated type to the barrel

After syncing, if a consumer needs a newly added type:

```ts
// src/types/index.ts
export type { NewPayload } from "./generated/NewPayload";
```

Then import via the barrel:

```ts
import type { NewPayload } from "@/types";
```

## Why this indirection

`tmai-core` is private for IP reasons, but its wire shapes must be public so
alternative UIs can be built. `tmai-api-spec` is that public surface — it is
the single source of truth for this repo. If a shape looks wrong here, fix it
in `tmai-core` → republish `tmai-api-spec` → re-sync, never patch
`generated/` in place.
