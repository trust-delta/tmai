//! AutoActionExecutor: event-driven worker guidance.
//!
//! Listens to `CoreEvent`s and, when `OrchestratorNotifySettings` configures
//! an event as `EventHandling::AutoAction`, directly instructs the target
//! worker (bypassing the orchestrator) by emitting a `PromptReady` event.
//!
//! Mutual exclusion with `OrchestratorNotifier` is enforced via
//! `EventHandling` — the notifier skips `AutoAction` events, and this
//! executor skips events not configured as `AutoAction`.

pub mod resolver;
pub mod service;
pub mod templates;
pub mod tracker;

pub use resolver::{is_agent_online, resolve_target_agent, AgentRole};
pub use service::{AutoActionExecutor, GithubApi, RealGithubApi};
pub use templates::{render, AutoActionTemplates};
pub use tracker::AutoActionTracker;
