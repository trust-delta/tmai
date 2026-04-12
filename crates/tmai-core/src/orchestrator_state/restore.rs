//! Tier 1 / Tier 2 orchestrator flag restoration logic.
//!
//! Callers invoke [`try_restore_agent`] after a new agent is first inserted
//! into `AppState::agents`, passing the Claude Code session_id lookup map
//! so the restore logic can identify the agent's session.

use std::collections::HashMap;

use chrono::{Duration, Utc};

use super::persist::{SharedOrchestratorStore, TIER2_RECENCY_HOURS};
use crate::hooks::registry::SessionPaneMap;
use crate::state::AppState;

/// Result of a single restore attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreOutcome {
    /// No action — no record matched or criteria unmet.
    NoAction,
    /// Tier 1 exact match: `(project_path, session_id)` already recorded.
    Tier1Exact,
    /// Tier 2 session-id rotation: project matched a recent record whose
    /// previous session is absent; the record has been rotated to the new
    /// session_id.
    Tier2RotateSession,
}

/// Look up the Claude Code session_id for an agent target by reversing
/// the `session_id → pane_id` map via `AppState::target_to_pane_id`.
fn lookup_session_id(
    state: &AppState,
    agent_target: &str,
    session_pane_map: &SessionPaneMap,
) -> Option<String> {
    let pane_id = state.target_to_pane_id.get(agent_target)?.clone();
    let map = session_pane_map.read();
    map.iter().find_map(|(sid, pid)| {
        if pid == &pane_id {
            Some(sid.clone())
        } else {
            None
        }
    })
}

/// Project path for an agent — prefer `git_common_dir`, else `cwd`.
fn project_path_for(state: &AppState, agent_target: &str) -> Option<String> {
    let agent = state.agents.get(agent_target)?;
    Some(
        agent
            .git_common_dir
            .clone()
            .unwrap_or_else(|| agent.cwd.clone()),
    )
}

/// Count currently-online agents whose session_id matches `session_id` and
/// project path matches `project_path`.
fn is_session_online(
    state: &AppState,
    session_pane_map: &SessionPaneMap,
    project_path: &str,
    session_id: &str,
) -> bool {
    // Build pane_id → target reverse map for the subset of agents in project.
    let candidate_pane_ids: Vec<String> = state
        .target_to_pane_id
        .iter()
        .filter_map(|(target, pane_id)| {
            state.agents.get(target).and_then(|a| {
                let proj = a.git_common_dir.clone().unwrap_or_else(|| a.cwd.clone());
                if proj == project_path {
                    Some(pane_id.clone())
                } else {
                    None
                }
            })
        })
        .collect();
    let map = session_pane_map.read();
    if let Some(pane_id) = map.get(session_id) {
        candidate_pane_ids.iter().any(|p| p == pane_id)
    } else {
        false
    }
}

/// All non-worktree online agents in the given project (candidates for Tier 2).
fn non_worktree_project_agents(state: &AppState, project_path: &str) -> Vec<String> {
    state
        .agents
        .iter()
        .filter(|(_, a)| {
            let proj = a.git_common_dir.clone().unwrap_or_else(|| a.cwd.clone());
            proj == project_path && !a.is_worktree.unwrap_or(false)
        })
        .map(|(id, _)| id.clone())
        .collect()
}

/// Attempt to restore `is_orchestrator=true` on `agent_target` using the
/// persisted store. Returns the outcome.
///
/// This function promotes the agent flag in state and rotates or touches the
/// persisted record as needed; it also persists to disk on a successful
/// restore.
pub fn try_restore_agent(
    state: &mut AppState,
    agent_target: &str,
    store: &SharedOrchestratorStore,
    session_pane_map: &SessionPaneMap,
) -> RestoreOutcome {
    // Skip if already orchestrator.
    if state
        .agents
        .get(agent_target)
        .map(|a| a.is_orchestrator)
        .unwrap_or(false)
    {
        return RestoreOutcome::NoAction;
    }

    let Some(project_path) = project_path_for(state, agent_target) else {
        return RestoreOutcome::NoAction;
    };

    // Skip worktree agents — only the main-repo orchestrator is restored.
    let is_worktree = state
        .agents
        .get(agent_target)
        .and_then(|a| a.is_worktree)
        .unwrap_or(false);
    if is_worktree {
        return RestoreOutcome::NoAction;
    }

    let session_id = lookup_session_id(state, agent_target, session_pane_map);

    // --- Tier 1 — exact match on (project_path, session_id) ---
    if let Some(ref sid) = session_id {
        let has_exact = store.read().find_exact(&project_path, sid).is_some();
        if has_exact {
            if let Some(agent) = state.agents.get_mut(agent_target) {
                agent.is_orchestrator = true;
            }
            // Touch last_seen + persist (ignore I/O errors — we already
            // applied the flag in memory).
            let mut w = store.write();
            if let Err(e) = w.upsert_and_save(&project_path, sid) {
                tracing::warn!(error = %e, "failed to persist orchestrator state after Tier 1 restore");
            }
            return RestoreOutcome::Tier1Exact;
        }
    }

    // --- Tier 2 — /resume fallback ---
    // Requires: at least one recent record for project, its previous session
    // is not currently online, and exactly one non-worktree candidate exists.
    let cutoff = Utc::now() - Duration::hours(TIER2_RECENCY_HOURS);
    let recent_record: Option<(String, String)> = {
        let r = store.read();
        let mut recents: Vec<&super::persist::OrchestratorRecord> = r
            .records_for_project(&project_path)
            .into_iter()
            .filter(|rec| rec.last_seen >= cutoff)
            .collect();
        recents.sort_by_key(|rec| std::cmp::Reverse(rec.last_seen));
        recents
            .first()
            .map(|rec| (rec.project_path.clone(), rec.claude_session_id.clone()))
    };
    let Some((rec_project, rec_session)) = recent_record else {
        return RestoreOutcome::NoAction;
    };

    // Don't Tier-2-restore if the recorded session_id matches the new agent's
    // session_id — Tier 1 would have caught it; arriving here implies either
    // no session_id was resolvable or it differs.
    if let Some(ref sid) = session_id {
        if sid == &rec_session {
            return RestoreOutcome::NoAction;
        }
    }

    // Recorded session must not be online (stale session implies /resume).
    if is_session_online(state, session_pane_map, &rec_project, &rec_session) {
        return RestoreOutcome::NoAction;
    }

    // Must have no other online orchestrator for this project already.
    let any_other_orchestrator = state.agents.iter().any(|(id, a)| {
        if id == agent_target {
            return false;
        }
        if !a.is_orchestrator {
            return false;
        }
        let proj = a.git_common_dir.clone().unwrap_or_else(|| a.cwd.clone());
        proj == project_path
    });
    if any_other_orchestrator {
        return RestoreOutcome::NoAction;
    }

    // Exactly one non-worktree candidate (this agent).
    let candidates = non_worktree_project_agents(state, &project_path);
    if candidates.len() != 1 || candidates[0] != agent_target {
        return RestoreOutcome::NoAction;
    }

    // Promote + rotate the record (or touch if session_id was unresolvable).
    if let Some(agent) = state.agents.get_mut(agent_target) {
        agent.is_orchestrator = true;
    }
    let mut w = store.write();
    if let Some(ref sid) = session_id {
        w.rotate_session(&rec_project, &rec_session, sid);
    } else {
        // Keep the record's session_id but update last_seen.
        w.upsert_in_memory(&rec_project, &rec_session);
    }
    if let Err(e) = w.save() {
        tracing::warn!(error = %e, "failed to persist orchestrator state after Tier 2 restore");
    }
    RestoreOutcome::Tier2RotateSession
}

/// Refresh `last_seen` on every persisted record that matches a currently-online
/// orchestrator. Intended to be called periodically from the polling loop.
pub fn update_last_seen_for_online(
    state: &AppState,
    store: &SharedOrchestratorStore,
    session_pane_map: &SessionPaneMap,
) {
    // Collect (project_path, session_id) for each online orchestrator.
    let mut online: Vec<(String, String)> = Vec::new();
    // Build pane_id → session_id reverse map once.
    let pane_to_session: HashMap<String, String> = {
        let m = session_pane_map.read();
        m.iter()
            .map(|(sid, pid)| (pid.clone(), sid.clone()))
            .collect()
    };
    for (target, agent) in &state.agents {
        if !agent.is_orchestrator {
            continue;
        }
        let project_path = agent
            .git_common_dir
            .clone()
            .unwrap_or_else(|| agent.cwd.clone());
        if let Some(pane_id) = state.target_to_pane_id.get(target) {
            if let Some(sid) = pane_to_session.get(pane_id) {
                online.push((project_path, sid.clone()));
            }
        }
    }
    if online.is_empty() {
        return;
    }
    let mut w = store.write();
    for (proj, sid) in &online {
        w.upsert_in_memory(proj, sid);
    }
    if let Err(e) = w.save() {
        tracing::warn!(error = %e, "failed to persist orchestrator state during last_seen refresh");
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentType, MonitoredAgent};
    use crate::hooks::new_session_pane_map;
    use crate::orchestrator_state::persist::OrchestratorStore;
    use parking_lot::RwLock;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct Ctx {
        _dir: TempDir,
        state: AppState,
        store: SharedOrchestratorStore,
        spm: SessionPaneMap,
    }

    fn make_agent(target: &str, cwd: &str, is_worktree: Option<bool>) -> MonitoredAgent {
        let mut a = MonitoredAgent::new(
            target.to_string(),
            AgentType::ClaudeCode,
            "Title".into(),
            cwd.into(),
            100,
            "main".into(),
            "win".into(),
            0,
            0,
        );
        a.is_worktree = is_worktree;
        a.git_common_dir = Some(cwd.into());
        a
    }

    fn setup() -> Ctx {
        let dir = TempDir::new().unwrap();
        let store_path = dir.path().join("orchestrators.json");
        let store = Arc::new(RwLock::new(OrchestratorStore::new(store_path)));
        let spm = new_session_pane_map();
        Ctx {
            _dir: dir,
            state: AppState::new(),
            store,
            spm,
        }
    }

    /// Insert agent into state and register its pane_id + session_id mapping
    /// so the restore module can look up the session_id.
    fn register_agent(
        ctx: &mut Ctx,
        target: &str,
        cwd: &str,
        is_worktree: Option<bool>,
        pane_id: &str,
        session_id: &str,
    ) {
        let agent = make_agent(target, cwd, is_worktree);
        ctx.state.agents.insert(target.to_string(), agent);
        ctx.state
            .target_to_pane_id
            .insert(target.to_string(), pane_id.to_string());
        ctx.spm
            .write()
            .insert(session_id.to_string(), pane_id.to_string());
    }

    #[test]
    fn tier1_exact_match_restores() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "sess-abc")
            .unwrap();

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "sess-abc",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::Tier1Exact);
        assert!(ctx.state.agents["main:0.0"].is_orchestrator);
    }

    #[test]
    fn tier1_no_match_does_nothing() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/other-proj", "sess-xyz")
            .unwrap();

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "sess-abc",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.0"].is_orchestrator);
    }

    #[test]
    fn tier2_single_candidate_resume_restores_and_rotates() {
        let mut ctx = setup();
        // Record has OLD session_id
        ctx.store
            .write()
            .upsert_and_save("/proj", "old-sess")
            .unwrap();

        // Agent came back with NEW session_id (post-/resume)
        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "new-sess",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::Tier2RotateSession);
        assert!(ctx.state.agents["main:0.0"].is_orchestrator);

        // Record rotated to new session_id
        let r = ctx.store.read();
        assert_eq!(r.records().len(), 1);
        assert_eq!(r.records()[0].claude_session_id, "new-sess");
    }

    #[test]
    fn tier2_rejects_multi_candidate() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "old-sess")
            .unwrap();

        // Two non-worktree candidates in same project
        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "new-sess",
        );
        register_agent(
            &mut ctx,
            "main:0.1",
            "/proj",
            Some(false),
            "pane-2",
            "another-sess",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.0"].is_orchestrator);
    }

    #[test]
    fn tier2_rejects_stale_last_seen() {
        let mut ctx = setup();
        // Seed a stale record (48h old — beyond 24h Tier2 cutoff but within 30d TTL)
        {
            let mut w = ctx.store.write();
            w.upsert_in_memory("/proj", "old-sess");
            let now = Utc::now();
            w.records[0].last_seen = now - Duration::hours(48);
            w.save().unwrap();
        }

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "new-sess",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.0"].is_orchestrator);
    }

    #[test]
    fn tier2_rejects_when_recorded_session_still_online() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "old-sess")
            .unwrap();

        // Old session agent STILL ONLINE
        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "old-sess",
        );
        // New-session agent candidate
        register_agent(
            &mut ctx,
            "main:0.1",
            "/proj",
            Some(false),
            "pane-2",
            "new-sess",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.1", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.1"].is_orchestrator);
    }

    #[test]
    fn tier2_rejects_when_existing_orchestrator_present() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "old-sess")
            .unwrap();

        // Some other agent is already orchestrator for project
        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "other-sess",
        );
        ctx.state
            .agents
            .get_mut("main:0.0")
            .unwrap()
            .is_orchestrator = true;
        register_agent(
            &mut ctx,
            "main:0.1",
            "/proj",
            Some(false),
            "pane-2",
            "new-sess",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.1", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.1"].is_orchestrator);
    }

    #[test]
    fn worktree_agent_is_skipped() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "sess-1")
            .unwrap();

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(true),
            "pane-1",
            "sess-1",
        );

        let out = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        assert_eq!(out, RestoreOutcome::NoAction);
        assert!(!ctx.state.agents["main:0.0"].is_orchestrator);
    }

    #[test]
    fn multi_orchestrator_both_tier1_restore() {
        let mut ctx = setup();
        ctx.store
            .write()
            .upsert_and_save("/proj", "sess-a")
            .unwrap();
        ctx.store
            .write()
            .upsert_and_save("/proj", "sess-b")
            .unwrap();

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "sess-a",
        );
        register_agent(
            &mut ctx,
            "main:0.1",
            "/proj",
            Some(false),
            "pane-2",
            "sess-b",
        );

        let o0 = try_restore_agent(&mut ctx.state, "main:0.0", &ctx.store, &ctx.spm);
        let o1 = try_restore_agent(&mut ctx.state, "main:0.1", &ctx.store, &ctx.spm);
        assert_eq!(o0, RestoreOutcome::Tier1Exact);
        assert_eq!(o1, RestoreOutcome::Tier1Exact);
        assert!(ctx.state.agents["main:0.0"].is_orchestrator);
        assert!(ctx.state.agents["main:0.1"].is_orchestrator);
    }

    #[test]
    fn update_last_seen_refreshes_online_orchestrators() {
        let mut ctx = setup();
        // Pre-seed with OLD last_seen
        {
            let mut w = ctx.store.write();
            w.upsert_in_memory("/proj", "sess-1");
            w.records[0].last_seen = Utc::now() - Duration::hours(5);
            w.save().unwrap();
        }
        let before = ctx.store.read().records()[0].last_seen;

        register_agent(
            &mut ctx,
            "main:0.0",
            "/proj",
            Some(false),
            "pane-1",
            "sess-1",
        );
        ctx.state
            .agents
            .get_mut("main:0.0")
            .unwrap()
            .is_orchestrator = true;

        update_last_seen_for_online(&ctx.state, &ctx.store, &ctx.spm);

        let after = ctx.store.read().records()[0].last_seen;
        assert!(after > before);
    }
}
