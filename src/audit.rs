//! Terminal output formatting for `tmai audit` subcommands

use tmai_core::audit::analyze::{
    AuditStats, DisagreementRecord, DisagreementSummary, MisdetectionRecord, MisdetectionSummary,
};
use tmai_core::config::AuditCommand;
use tmai_core::detectors::DetectionConfidence;

// ANSI color codes
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RESET: &str = "\x1b[0m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const RED: &str = "\x1b[31m";
const CYAN: &str = "\x1b[36m";
const MAGENTA: &str = "\x1b[35m";

/// Run the audit subcommand (non-async, no TUI/Web)
pub fn run(subcommand: &AuditCommand) {
    let events = tmai_core::audit::reader::read_all_events();

    if events.is_empty() {
        print_no_data_message();
        return;
    }

    match subcommand {
        AuditCommand::Stats { top } => {
            let stats = tmai_core::audit::analyze::compute_stats(&events);
            print_stats(&stats, *top);
        }
        AuditCommand::Misdetections { limit } => {
            let summary = tmai_core::audit::analyze::compute_misdetections(&events, *limit);
            print_misdetections(&summary);
        }
        AuditCommand::Disagreements { limit } => {
            let summary = tmai_core::audit::analyze::compute_disagreements(&events, *limit);
            print_disagreements(&summary);
        }
    }
}

/// Print a helpful message when no audit data is found
fn print_no_data_message() {
    println!("{BOLD}No audit data found.{RESET}");
    println!();
    println!("To enable audit logging, use one of:");
    println!("  {CYAN}tmai --audit{RESET}              (CLI flag)");
    println!("  {CYAN}[audit]{RESET}");
    println!("  {CYAN}enabled = true{RESET}           (in ~/.config/tmai/config.toml)");
    println!();
    println!("Audit logs are written to: {DIM}/tmp/tmai/audit/detection.ndjson{RESET}");
}

/// Print aggregate statistics
fn print_stats(stats: &AuditStats, top: usize) {
    // Header
    println!("{BOLD}=== Audit Statistics ==={RESET}");
    println!();

    // Time range
    if let (Some(ts_min), Some(ts_max)) = (stats.ts_min, stats.ts_max) {
        let min_time = format_timestamp(ts_min);
        let max_time = format_timestamp(ts_max);
        println!("  {DIM}Time range:{RESET} {min_time}  →  {max_time}");
        let duration_secs = (ts_max - ts_min) / 1000;
        let hours = duration_secs / 3600;
        let mins = (duration_secs % 3600) / 60;
        println!("  {DIM}Duration:{RESET}   {hours}h {mins}m");
        println!();
    }

    println!("  {BOLD}Total events:{RESET} {}", stats.total_events);
    println!();

    // Event type breakdown
    println!("  {BOLD}By event type:{RESET}");
    let mut event_types: Vec<(&String, &usize)> = stats.by_event_type.iter().collect();
    event_types.sort_by(|a, b| b.1.cmp(a.1));
    let max_count = event_types.first().map(|(_, c)| **c).unwrap_or(1);
    for (event_type, count) in &event_types {
        let bar = make_bar(**count, max_count, 30);
        println!("    {:<30} {:>6}  {bar}", event_type, count);
    }
    println!();

    // Confidence breakdown
    if !stats.by_confidence.is_empty() {
        println!("  {BOLD}By confidence:{RESET}");
        for confidence in &[
            DetectionConfidence::High,
            DetectionConfidence::Medium,
            DetectionConfidence::Low,
        ] {
            if let Some(count) = stats.by_confidence.get(confidence) {
                let color = confidence_color(confidence);
                println!(
                    "    {color}{:<10}{RESET} {:>6}",
                    format!("{confidence:?}"),
                    count
                );
            }
        }
        println!();
    }

    // Agent type breakdown
    if !stats.by_agent_type.is_empty() {
        println!("  {BOLD}By agent type:{RESET}");
        let mut agent_types: Vec<(&String, &usize)> = stats.by_agent_type.iter().collect();
        agent_types.sort_by(|a, b| b.1.cmp(a.1));
        for (agent_type, count) in &agent_types {
            println!("    {:<20} {:>6}", agent_type, count);
        }
        println!();
    }

    // Top rules
    if !stats.rule_hits.is_empty() {
        let display_count = top.min(stats.rule_hits.len());
        println!("  {BOLD}Top {display_count} detection rules:{RESET}");
        let rule_max = stats.rule_hits.first().map(|(_, c)| *c).unwrap_or(1);
        for (rule, count) in stats.rule_hits.iter().take(top) {
            let bar = make_bar(*count, rule_max, 30);
            println!("    {:<40} {:>6}  {bar}", rule, count);
        }
    }
}

/// Print misdetection analysis
fn print_misdetections(summary: &MisdetectionSummary) {
    println!("{BOLD}=== Misdetection Analysis ==={RESET}");
    println!("  {DIM}(UserInputDuringProcessing events — user input while agent detected as Processing){RESET}");
    println!();
    println!("  {BOLD}Total events:{RESET} {}", summary.total);
    println!();

    if summary.total == 0 {
        println!("  {GREEN}No misdetection signals found.{RESET}");
        return;
    }

    // By rule
    println!("  {BOLD}By detection rule at time of input:{RESET}");
    let rule_max = summary.by_rule.first().map(|(_, c)| *c).unwrap_or(1);
    for (rule, count) in &summary.by_rule {
        let bar = make_bar(*count, rule_max, 30);
        println!("    {:<40} {:>6}  {bar}", rule, count);
    }
    println!();

    // Individual records
    if !summary.records.is_empty() {
        println!(
            "  {BOLD}Recent records (newest first, showing {}):{RESET}",
            summary.records.len()
        );
        println!(
            "  {DIM}{:<22} {:<10} {:<15} {:<20} {:<15} {:<15}{RESET}",
            "Timestamp", "Pane", "Agent", "Rule", "Action", "Source"
        );
        for record in &summary.records {
            print_misdetection_record(record);
        }
    }
}

/// Print a single misdetection record
fn print_misdetection_record(record: &MisdetectionRecord) {
    let ts = format_timestamp(record.ts);
    println!(
        "  {:<22} {:<10} {:<15} {YELLOW}{:<20}{RESET} {:<15} {DIM}{:<15}{RESET}",
        ts, record.pane_id, record.agent_type, record.rule, record.action, record.input_source,
    );
}

/// Print disagreement analysis
fn print_disagreements(summary: &DisagreementSummary) {
    println!("{BOLD}=== Source Disagreement Analysis ==={RESET}");
    println!("  {DIM}(IPC and capture-pane detected different statuses){RESET}");
    println!();
    println!("  {BOLD}Total events:{RESET} {}", summary.total);
    println!();

    if summary.total == 0 {
        println!("  {GREEN}No source disagreements found.{RESET}");
        return;
    }

    // By capture rule
    println!("  {BOLD}By capture-pane rule:{RESET}");
    let rule_max = summary
        .by_capture_rule
        .first()
        .map(|(_, c)| *c)
        .unwrap_or(1);
    for (rule, count) in &summary.by_capture_rule {
        let bar = make_bar(*count, rule_max, 30);
        println!("    {:<40} {:>6}  {bar}", rule, count);
    }
    println!();

    // By pane
    println!("  {BOLD}By pane:{RESET}");
    for (pane, count) in &summary.by_pane {
        println!("    {:<20} {:>6}", pane, count);
    }
    println!();

    // Individual records
    if !summary.records.is_empty() {
        println!(
            "  {BOLD}Recent records (newest first, showing {}):{RESET}",
            summary.records.len()
        );
        println!(
            "  {DIM}{:<22} {:<10} {:<15} {:<15} {:<15} {:<25}{RESET}",
            "Timestamp", "Pane", "Agent", "IPC", "Capture", "Capture Rule"
        );
        for record in &summary.records {
            print_disagreement_record(record);
        }
    }
}

/// Print a single disagreement record
fn print_disagreement_record(record: &DisagreementRecord) {
    let ts = format_timestamp(record.ts);
    println!(
        "  {:<22} {:<10} {:<15} {CYAN}{:<15}{RESET} {RED}{:<15}{RESET} {MAGENTA}{:<25}{RESET}",
        ts,
        record.pane_id,
        record.agent_type,
        record.ipc_status,
        record.capture_status,
        record.capture_rule,
    );
}

/// Format a millisecond timestamp to local time string
fn format_timestamp(ts_ms: u64) -> String {
    use chrono::{Local, TimeZone};
    let secs = (ts_ms / 1000) as i64;
    let nanos = ((ts_ms % 1000) * 1_000_000) as u32;
    match Local.timestamp_opt(secs, nanos) {
        chrono::LocalResult::Single(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        _ => format!("{}ms", ts_ms),
    }
}

/// Create a simple bar chart
fn make_bar(value: usize, max: usize, width: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let filled = (value * width) / max;
    let filled = filled.max(1); // at least 1 char for non-zero values
    format!("{DIM}{}{RESET}", "█".repeat(filled))
}

/// Get ANSI color for a confidence level
fn confidence_color(confidence: &DetectionConfidence) -> &'static str {
    match confidence {
        DetectionConfidence::High => GREEN,
        DetectionConfidence::Medium => YELLOW,
        DetectionConfidence::Low => RED,
    }
}
