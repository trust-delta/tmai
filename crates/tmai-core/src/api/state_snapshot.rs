//! Compose a concise project state snapshot for injection into an
//! orchestrator's spawn prompt (#381).
//!
//! Splits data collection (async — gh / git shell-outs) from formatting
//! (pure, unit-testable). A freshly-spawned orchestrator would otherwise
//! burn its first turns running `list_agents` / `list_prs` to reconstruct
//! the same state tmai already knows about.

use crate::agents::AgentStatus;
use crate::api::types::AgentSnapshot;
use crate::api::TmaiCore;
use crate::github::{self, CheckStatus, IssueInfo, PrInfo, ReviewDecision};

/// Maximum items shown per list before truncation.
const MAX_ITEMS: usize = 10;

/// Hard cap on the rendered snapshot size so injection never overwhelms
/// the prompt budget the operator configured on the orchestrator role.
const MAX_TOTAL_BYTES: usize = 4096;

/// Number of recent commits on the configured base branch to surface.
const RECENT_COMMITS: usize = 5;

/// Base branch used for the "recent merges" section. `main` is the tmai
/// convention; projects that use a different base will get an empty
/// section (degrades gracefully — we don't block spawn on it).
const DEFAULT_BASE_BRANCH: &str = "main";

/// Flattened data for rendering. Keeping this as a plain struct lets the
/// formatter be exercised without touching gh/git.
#[derive(Debug, Default)]
pub(crate) struct SnapshotData {
    pub open_prs: Vec<PrRow>,
    pub active_agents: Vec<AgentRow>,
    pub recent_merges: Vec<String>,
    pub open_issues: Vec<IssueRow>,
}

#[derive(Debug)]
pub(crate) struct PrRow {
    pub number: u64,
    pub title: String,
    pub is_draft: bool,
    pub ci: &'static str,
    pub review: &'static str,
}

#[derive(Debug)]
pub(crate) struct AgentRow {
    pub display_name: String,
    pub role: &'static str,
    pub status: String,
    pub tag: Option<String>,
}

#[derive(Debug)]
pub(crate) struct IssueRow {
    pub number: u64,
    pub title: String,
}

/// Gather the snapshot for `project_path`. Any individual source failing
/// (gh offline, repo without a `main` branch, etc.) is treated as an
/// empty section so spawn never aborts on snapshot collection (#381
/// graceful-degradation requirement).
pub(crate) async fn collect(core: &TmaiCore, project_path: &str) -> SnapshotData {
    let open_prs = github::list_open_prs(project_path)
        .await
        .map(prs_from_map)
        .unwrap_or_default();

    let active_agents = core
        .list_agents_by_project(project_path)
        .into_iter()
        .map(agent_row)
        .collect();

    let recent_merges = recent_merges(project_path, DEFAULT_BASE_BRANCH, RECENT_COMMITS).await;

    let open_issues = github::list_issues(project_path)
        .await
        .map(issues_from_vec)
        .unwrap_or_default();

    SnapshotData {
        open_prs,
        active_agents,
        recent_merges,
        open_issues,
    }
}

fn prs_from_map(map: std::collections::HashMap<String, PrInfo>) -> Vec<PrRow> {
    let mut rows: Vec<PrRow> = map
        .into_values()
        .map(|pr| PrRow {
            number: pr.number,
            title: pr.title,
            is_draft: pr.is_draft,
            ci: check_status_label(pr.check_status.as_ref()),
            review: review_decision_label(pr.review_decision.as_ref()),
        })
        .collect();
    // Highest PR number first — proxy for "most recent work".
    rows.sort_by_key(|r| std::cmp::Reverse(r.number));
    rows
}

fn issues_from_vec(issues: Vec<IssueInfo>) -> Vec<IssueRow> {
    let mut rows: Vec<IssueRow> = issues
        .into_iter()
        .map(|i| IssueRow {
            number: i.number,
            title: i.title,
        })
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.number));
    rows
}

fn agent_row(a: AgentSnapshot) -> AgentRow {
    let tag = match (a.issue_number, a.pr_number) {
        (Some(n), _) => Some(format!("issue #{n}")),
        (None, Some(n)) => Some(format!("PR #{n}")),
        _ => None,
    };
    AgentRow {
        display_name: a.display_name,
        role: if a.is_orchestrator {
            "orchestrator"
        } else {
            "worker"
        },
        status: status_label(&a.status).to_string(),
        tag,
    }
}

fn status_label(s: &AgentStatus) -> &'static str {
    match s {
        AgentStatus::Idle => "Idle",
        AgentStatus::Processing { .. } => "Working",
        AgentStatus::AwaitingApproval { .. } => "AwaitingApproval",
        AgentStatus::Error { .. } => "Error",
        AgentStatus::Offline => "Offline",
        AgentStatus::Unknown => "Unknown",
    }
}

fn check_status_label(s: Option<&CheckStatus>) -> &'static str {
    match s {
        Some(CheckStatus::Success) => "passed",
        Some(CheckStatus::Failure) => "failed",
        Some(CheckStatus::Pending) => "pending",
        Some(CheckStatus::Unknown) | None => "unknown",
    }
}

fn review_decision_label(r: Option<&ReviewDecision>) -> &'static str {
    match r {
        Some(ReviewDecision::Approved) => "approved",
        Some(ReviewDecision::ChangesRequested) => "changes-requested",
        Some(ReviewDecision::ReviewRequired) => "review-required",
        Some(ReviewDecision::Unknown) | None => "no-review",
    }
}

/// Read `git log --oneline -n N <base_branch>` from the project path.
/// Returns an empty Vec on any failure (missing git, unknown branch, etc.).
async fn recent_merges(repo_dir: &str, base_branch: &str, n: usize) -> Vec<String> {
    let output = tokio::process::Command::new("git")
        .args([
            "-C",
            repo_dir,
            "log",
            "--oneline",
            "-n",
            &n.to_string(),
            base_branch,
        ])
        .output()
        .await;
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect()
}

/// Render the snapshot as markdown. Total size is capped at
/// [`MAX_TOTAL_BYTES`] so pathological state can't blow the prompt budget.
pub(crate) fn format(data: &SnapshotData) -> String {
    let mut out = String::new();
    out.push_str("## Current state snapshot (as of spawn)\n");

    render_prs(&mut out, &data.open_prs);
    render_agents(&mut out, &data.active_agents);
    render_merges(&mut out, &data.recent_merges);
    render_issues(&mut out, &data.open_issues);

    if out.len() > MAX_TOTAL_BYTES {
        // Cut on a char boundary — `…` is the only multi-byte char we emit,
        // so a naive `String::truncate` at a byte index could panic.
        truncate_on_char_boundary(&mut out, MAX_TOTAL_BYTES);
        out.push_str("\n… (snapshot truncated)\n");
    }

    out
}

fn render_prs(out: &mut String, prs: &[PrRow]) {
    out.push_str(&format!("\n### Open PRs ({})\n", prs.len()));
    if prs.is_empty() {
        out.push_str("- none currently\n");
        return;
    }
    for pr in prs.iter().take(MAX_ITEMS) {
        let draft = if pr.is_draft { " [draft]" } else { "" };
        out.push_str(&format!(
            "- #{} {}{} — CI {}, review {}\n",
            pr.number, pr.title, draft, pr.ci, pr.review,
        ));
    }
    if prs.len() > MAX_ITEMS {
        out.push_str(&format!("- … and {} more\n", prs.len() - MAX_ITEMS));
    }
}

fn render_agents(out: &mut String, agents: &[AgentRow]) {
    out.push_str(&format!("\n### Active agents ({})\n", agents.len()));
    if agents.is_empty() {
        out.push_str("- none currently\n");
        return;
    }
    for a in agents.iter().take(MAX_ITEMS) {
        let tag = a
            .tag
            .as_ref()
            .map(|t| format!(" [{t}]"))
            .unwrap_or_default();
        out.push_str(&format!(
            "- {} — {}{} ({})\n",
            a.display_name, a.role, tag, a.status,
        ));
    }
    if agents.len() > MAX_ITEMS {
        out.push_str(&format!("- … and {} more\n", agents.len() - MAX_ITEMS));
    }
}

fn render_merges(out: &mut String, merges: &[String]) {
    out.push_str(&format!(
        "\n### Recent merges (last {} commits on {})\n",
        merges.len(),
        DEFAULT_BASE_BRANCH,
    ));
    if merges.is_empty() {
        out.push_str("- none currently\n");
        return;
    }
    for line in merges {
        out.push_str(&format!("- {line}\n"));
    }
}

fn render_issues(out: &mut String, issues: &[IssueRow]) {
    out.push_str(&format!("\n### Open issues ({})\n", issues.len()));
    if issues.is_empty() {
        out.push_str("- none currently\n");
        return;
    }
    for i in issues.iter().take(MAX_ITEMS) {
        out.push_str(&format!("- #{} {}\n", i.number, i.title));
    }
    if issues.len() > MAX_ITEMS {
        out.push_str(&format!("- … and {} more\n", issues.len() - MAX_ITEMS));
    }
}

fn truncate_on_char_boundary(s: &mut String, max_len: usize) {
    if s.len() <= max_len {
        return;
    }
    let mut cut = max_len;
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    s.truncate(cut);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pr_row(n: u64) -> PrRow {
        PrRow {
            number: n,
            title: format!("feat: thing {n}"),
            is_draft: false,
            ci: "passed",
            review: "no-review",
        }
    }

    fn issue_row(n: u64) -> IssueRow {
        IssueRow {
            number: n,
            title: format!("issue {n}"),
        }
    }

    #[test]
    fn format_includes_snapshot_header() {
        let out = format(&SnapshotData::default());
        assert!(out.starts_with("## Current state snapshot"));
    }

    #[test]
    fn empty_project_renders_gracefully() {
        let out = format(&SnapshotData::default());
        // Every section must appear with a "none currently" line — otherwise
        // the orchestrator sees a blank block and guesses it's an injection
        // bug rather than "truly nothing to do".
        assert!(out.contains("### Open PRs (0)"));
        assert!(out.contains("### Active agents (0)"));
        assert!(out.contains("### Recent merges"));
        assert!(out.contains("### Open issues (0)"));
        assert_eq!(out.matches("- none currently").count(), 4);
    }

    #[test]
    fn truncates_long_pr_list_with_ellipsis_suffix() {
        // `collect` hands us PRs sorted highest-number first — emulate that
        // ordering so the take(10) window matches what the prompt actually
        // sees in production.
        let prs: Vec<PrRow> = (1..=30).rev().map(pr_row).collect();
        let data = SnapshotData {
            open_prs: prs,
            ..Default::default()
        };
        let out = format(&data);
        assert!(out.contains("### Open PRs (30)"));
        assert!(out.contains("#30 feat: thing 30"));
        assert!(out.contains("#21 feat: thing 21"));
        // 11th entry (#20) must not render directly — it belongs in the
        // collapsed tail.
        assert!(!out.contains("- #20 feat: thing 20"));
        assert!(out.contains("- … and 20 more"));
    }

    #[test]
    fn truncates_long_issue_list() {
        let issues: Vec<IssueRow> = (1..=15).rev().map(issue_row).collect();
        let data = SnapshotData {
            open_issues: issues,
            ..Default::default()
        };
        let out = format(&data);
        assert!(out.contains("### Open issues (15)"));
        assert!(out.contains("- … and 5 more"));
    }

    #[test]
    fn pr_line_includes_draft_and_status() {
        let data = SnapshotData {
            open_prs: vec![PrRow {
                number: 42,
                title: "wip: stuff".into(),
                is_draft: true,
                ci: "failed",
                review: "changes-requested",
            }],
            ..Default::default()
        };
        let out = format(&data);
        assert!(out.contains("- #42 wip: stuff [draft] — CI failed, review changes-requested"));
    }

    #[test]
    fn total_size_is_capped() {
        // Even after per-list truncation, pathologically long PR titles can
        // still push the snapshot past the prompt budget. Ten entries × a
        // 1000-char title yields >10KB; the byte-cap fallback must catch it.
        let prs: Vec<PrRow> = (1..=10)
            .rev()
            .map(|n| PrRow {
                number: n,
                title: "x".repeat(1000),
                is_draft: false,
                ci: "passed",
                review: "no-review",
            })
            .collect();
        let data = SnapshotData {
            open_prs: prs,
            ..Default::default()
        };
        let out = format(&data);
        assert!(
            out.len() <= MAX_TOTAL_BYTES + 64,
            "snapshot {} > cap {}",
            out.len(),
            MAX_TOTAL_BYTES,
        );
        assert!(out.contains("(snapshot truncated)"));
    }

    #[test]
    fn status_label_maps_variants() {
        assert_eq!(status_label(&AgentStatus::Idle), "Idle");
        assert_eq!(status_label(&AgentStatus::Offline), "Offline");
        assert_eq!(status_label(&AgentStatus::Unknown), "Unknown");
        assert_eq!(
            status_label(&AgentStatus::Error {
                message: "boom".into()
            }),
            "Error"
        );
    }
}
