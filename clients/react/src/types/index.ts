// Re-exports for types sourced from the in-repo wire contract.
//
// Files under `./generated/` mirror the TypeScript output of `xtask` in
// the private `tmai-core` repo. They land here via the `gen-spec-pr` bot
// PRs that also refresh `api-spec/` at the monorepo root. Do not hand-edit
// `./generated/` — see ./README.md for the sync flow.

export type { ActionOrigin } from "./generated/ActionOrigin";
export type { BootstrapRequiredEvent } from "./generated/BootstrapRequiredEvent";
export type { CoreEvent } from "./generated/CoreEvent";
export type { DispatchSnapshot } from "./generated/DispatchSnapshot";
export type { EntityChange } from "./generated/EntityChange";
export type { EntityUpdateEnvelope } from "./generated/EntityUpdateEnvelope";
export type { GuardrailKind } from "./generated/GuardrailKind";
export type { Milestone } from "./generated/Milestone";
export type { QueueSnapshot } from "./generated/QueueSnapshot";
export type { RuntimeSnapshot } from "./generated/RuntimeSnapshot";
export type { TaskMetaSnapshot } from "./generated/TaskMetaSnapshot";
export type { TeamSnapshot } from "./generated/TeamSnapshot";
export type { WorkflowSnapshot } from "./generated/WorkflowSnapshot";
export type { WorktreeInfo } from "./generated/WorktreeInfo";
export type { WorktreeSnapshot } from "./generated/WorktreeSnapshot";
