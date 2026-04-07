//! Node-based flow orchestration engine.
//!
//! Replaces `orchestrator_notify` with a stateful flow engine that executes
//! deterministic stop-to-kick chains based on pre-configured flow definitions.
//!
//! ## Architecture
//!
//! - **FlowRegistry**: holds parsed `FlowConfig` definitions from config.toml
//! - **FlowEngine**: background service (tokio::spawn) that subscribes to CoreEvents,
//!   matches agent stops to FlowRuns, and executes edge pipelines
//! - **FlowRun**: runtime execution instance tracking progress through nodes
//!
//! See `.claude/decisions/2026-04-07-flow-edge-specification.md` for the full design.

pub mod action;
pub mod condition;
pub mod engine;
pub mod executor;
pub mod prompt;
pub mod real_executor;
pub mod registry;
pub mod resolver;
pub mod template;
pub mod types;

pub use engine::{FlowEngine, FlowEngineHandle};
pub use registry::FlowRegistry;
pub use types::*;
