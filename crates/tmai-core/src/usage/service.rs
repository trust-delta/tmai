//! Background service that auto-fetches usage data on agent spawn and
//! (when configured) on a periodic interval.
//!
//! Without this service, the usage widget only populates after the user
//! clicks the refresh button in the WebUI. See GitHub issue #370.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::broadcast;
use tokio::time::{interval, MissedTickBehavior};
use tracing::{debug, info};

use crate::api::{CoreEvent, TmaiCore};

/// Minimum gap between consecutive auto-fetches. Running `/usage` spawns a
/// temporary Claude Code instance, so we avoid piling up fetches when several
/// agents spawn in quick succession.
const SPAWN_DEBOUNCE: Duration = Duration::from_secs(15);

/// How often the periodic tick fires. The service only triggers a fetch if
/// `auto_refresh_min` minutes have elapsed since the last fetch.
const TICK_INTERVAL: Duration = Duration::from_secs(60);

/// Service that keeps the usage snapshot fresh without user intervention.
pub struct UsageAutoFetchService;

impl UsageAutoFetchService {
    /// Spawn the background service.
    ///
    /// Listens for:
    /// - [`CoreEvent::AgentAppeared`]: triggers a fetch (subject to
    ///   [`SPAWN_DEBOUNCE`]) so usage reflects the newly spawned agent.
    /// - Periodic tick: refetches when `usage.auto_refresh_min > 0` and the
    ///   configured interval has elapsed.
    pub fn spawn(
        core: Arc<TmaiCore>,
        mut event_rx: broadcast::Receiver<CoreEvent>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut last_trigger: Option<Instant> = None;
            let mut ticker = interval(TICK_INTERVAL);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            // `interval` fires immediately on first `tick()`; skip so the
            // startup fetch from `start_initial_usage_fetch` is not duplicated.
            ticker.tick().await;

            loop {
                tokio::select! {
                    event = event_rx.recv() => match event {
                        Ok(CoreEvent::AgentAppeared { target }) => {
                            if should_fetch_on_spawn(&core, &last_trigger) {
                                info!(
                                    target = %target,
                                    "Usage auto-fetch: agent spawned, triggering fetch"
                                );
                                last_trigger = Some(Instant::now());
                                core.fetch_usage();
                            }
                        }
                        Ok(_) => {}
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            debug!(skipped = n, "UsageAutoFetchService lagged");
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            debug!("Event channel closed, stopping UsageAutoFetchService");
                            break;
                        }
                    },
                    _ = ticker.tick() => {
                        if should_fetch_on_tick(&core) {
                            debug!("Usage auto-fetch: periodic refresh triggered");
                            last_trigger = Some(Instant::now());
                            core.fetch_usage();
                        }
                    }
                }
            }
        })
    }
}

fn should_fetch_on_spawn(core: &Arc<TmaiCore>, last_trigger: &Option<Instant>) -> bool {
    if !core.settings().usage.enabled {
        return false;
    }
    if core.get_usage().fetching {
        return false;
    }
    !matches!(last_trigger, Some(t) if Instant::now().duration_since(*t) < SPAWN_DEBOUNCE)
}

fn should_fetch_on_tick(core: &Arc<TmaiCore>) -> bool {
    let settings = core.settings();
    if !settings.usage.enabled {
        return false;
    }
    // `auto_refresh_min = 0` means "manual only" — respect the user's choice
    // and do not force periodic refreshes.
    let interval_min = settings.usage.auto_refresh_min;
    if interval_min == 0 {
        return false;
    }
    let snapshot = core.get_usage();
    if snapshot.fetching {
        return false;
    }
    snapshot
        .fetched_at
        .map(|t| {
            let elapsed = chrono::Utc::now() - t;
            elapsed.num_minutes() >= i64::from(interval_min)
        })
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::TmaiCoreBuilder;
    use crate::config::Settings;

    fn core_with_usage(enabled: bool, auto_refresh_min: u32) -> Arc<TmaiCore> {
        let mut settings = Settings::default();
        settings.usage.enabled = enabled;
        settings.usage.auto_refresh_min = auto_refresh_min;
        Arc::new(TmaiCoreBuilder::new(settings).build())
    }

    #[test]
    fn spawn_gate_respects_enabled_flag() {
        let core = core_with_usage(false, 0);
        assert!(!should_fetch_on_spawn(&core, &None));
    }

    #[test]
    fn spawn_gate_allows_first_event_when_enabled() {
        let core = core_with_usage(true, 0);
        assert!(should_fetch_on_spawn(&core, &None));
    }

    #[test]
    fn spawn_gate_debounces_rapid_events() {
        let core = core_with_usage(true, 0);
        let just_now = Instant::now();
        assert!(!should_fetch_on_spawn(&core, &Some(just_now)));
    }

    #[test]
    fn spawn_gate_blocks_while_fetching() {
        let core = core_with_usage(true, 0);
        {
            // Mark as already fetching so subsequent triggers become no-ops.
            #[allow(deprecated)]
            let mut s = core.raw_state().write();
            s.usage.fetching = true;
        }
        assert!(!should_fetch_on_spawn(&core, &None));
    }

    #[test]
    fn tick_gate_respects_manual_only_setting() {
        let core = core_with_usage(true, 0);
        assert!(!should_fetch_on_tick(&core));
    }

    #[test]
    fn tick_gate_fetches_when_never_fetched() {
        let core = core_with_usage(true, 30);
        assert!(should_fetch_on_tick(&core));
    }

    #[test]
    fn tick_gate_skips_when_recent_fetch() {
        let core = core_with_usage(true, 30);
        {
            #[allow(deprecated)]
            let mut s = core.raw_state().write();
            s.usage.fetched_at = Some(chrono::Utc::now());
        }
        assert!(!should_fetch_on_tick(&core));
    }

    #[test]
    fn tick_gate_fetches_when_interval_elapsed() {
        let core = core_with_usage(true, 30);
        {
            #[allow(deprecated)]
            let mut s = core.raw_state().write();
            s.usage.fetched_at = Some(chrono::Utc::now() - chrono::Duration::minutes(45));
        }
        assert!(should_fetch_on_tick(&core));
    }
}
