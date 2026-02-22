//! Terminal output formatting for `tmai audit` subcommands

use tmai_core::audit::analyze::{
    AuditStats, DisagreementRecord, DisagreementSummary, MisdetectionRecord, MisdetectionSummary,
};
use tmai_core::config::AuditCommand;
use tmai_core::detectors::DetectionConfidence;

/// Whether color output is enabled (TTY + NO_COLOR not set)
fn use_color() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

/// ANSI color codes container (empty strings when color is disabled)
struct Colors {
    bold: &'static str,
    dim: &'static str,
    reset: &'static str,
    green: &'static str,
    yellow: &'static str,
    red: &'static str,
    cyan: &'static str,
    magenta: &'static str,
}

impl Colors {
    fn new() -> Self {
        if use_color() {
            Self {
                bold: "\x1b[1m",
                dim: "\x1b[2m",
                reset: "\x1b[0m",
                green: "\x1b[32m",
                yellow: "\x1b[33m",
                red: "\x1b[31m",
                cyan: "\x1b[36m",
                magenta: "\x1b[35m",
            }
        } else {
            Self {
                bold: "",
                dim: "",
                reset: "",
                green: "",
                yellow: "",
                red: "",
                cyan: "",
                magenta: "",
            }
        }
    }

    /// Get color for a confidence level
    fn confidence(&self, confidence: &DetectionConfidence) -> &str {
        match confidence {
            DetectionConfidence::High => self.green,
            DetectionConfidence::Medium => self.yellow,
            DetectionConfidence::Low => self.red,
        }
    }
}

/// Run the audit subcommand (non-async, no TUI/Web)
pub fn run(subcommand: &AuditCommand) {
    let events = tmai_core::audit::reader::read_all_events();
    let c = Colors::new();

    if events.is_empty() {
        print_no_data_message(&c);
        return;
    }

    match subcommand {
        AuditCommand::Stats { top } => {
            let stats = tmai_core::audit::analyze::compute_stats(&events);
            print_stats(&c, &stats, *top);
        }
        AuditCommand::Misdetections { limit } => {
            let summary = tmai_core::audit::analyze::compute_misdetections(&events, *limit);
            print_misdetections(&c, &summary);
        }
        AuditCommand::Disagreements { limit } => {
            let summary = tmai_core::audit::analyze::compute_disagreements(&events, *limit);
            print_disagreements(&c, &summary);
        }
    }
}

/// Print a helpful message when no audit data is found
fn print_no_data_message(c: &Colors) {
    let audit_file = tmai_core::ipc::protocol::state_dir().join("audit/detection.ndjson");
    let audit_path = audit_file.display();
    println!("{}No audit data found.{}", c.bold, c.reset);
    println!();
    println!("To enable audit logging, use one of:");
    println!(
        "  {}tmai --audit{}              (CLI flag)",
        c.cyan, c.reset
    );
    println!("  {}[audit]{}", c.cyan, c.reset);
    println!(
        "  {}enabled = true{}           (in ~/.config/tmai/config.toml)",
        c.cyan, c.reset
    );
    println!();
    println!(
        "Audit logs are written to: {}{}{}",
        c.dim, audit_path, c.reset
    );
}

/// Print aggregate statistics
fn print_stats(c: &Colors, stats: &AuditStats, top: usize) {
    println!("{}=== Audit Statistics ==={}", c.bold, c.reset);
    println!();

    // Time range
    if let (Some(ts_min), Some(ts_max)) = (stats.ts_min, stats.ts_max) {
        let min_time = format_timestamp(ts_min);
        let max_time = format_timestamp(ts_max);
        println!(
            "  {}Time range:{} {min_time}  →  {max_time}",
            c.dim, c.reset
        );
        let duration_secs = (ts_max - ts_min) / 1000;
        let hours = duration_secs / 3600;
        let mins = (duration_secs % 3600) / 60;
        println!("  {}Duration:{}   {hours}h {mins}m", c.dim, c.reset);
        println!();
    }

    println!(
        "  {}Total events:{} {}",
        c.bold, c.reset, stats.total_events
    );
    println!();

    // Event type breakdown
    println!("  {}By event type:{}", c.bold, c.reset);
    let mut event_types: Vec<(&String, &usize)> = stats.by_event_type.iter().collect();
    event_types.sort_by(|a, b| b.1.cmp(a.1));
    let max_count = event_types.first().map(|(_, n)| **n).unwrap_or(1);
    for (event_type, count) in &event_types {
        let bar = make_bar(c, **count, max_count, 30);
        println!("    {:<30} {:>6}  {bar}", event_type, count);
    }
    println!();

    // Confidence breakdown
    if !stats.by_confidence.is_empty() {
        println!("  {}By confidence:{}", c.bold, c.reset);
        for confidence in &[
            DetectionConfidence::High,
            DetectionConfidence::Medium,
            DetectionConfidence::Low,
        ] {
            if let Some(count) = stats.by_confidence.get(confidence) {
                let clr = c.confidence(confidence);
                println!(
                    "    {clr}{:<10}{} {:>6}",
                    format!("{confidence:?}"),
                    c.reset,
                    count
                );
            }
        }
        println!();
    }

    // Agent type breakdown
    if !stats.by_agent_type.is_empty() {
        println!("  {}By agent type:{}", c.bold, c.reset);
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
        println!(
            "  {}Top {display_count} detection rules:{}",
            c.bold, c.reset
        );
        let rule_max = stats.rule_hits.first().map(|(_, n)| *n).unwrap_or(1);
        for (rule, count) in stats.rule_hits.iter().take(top) {
            let bar = make_bar(c, *count, rule_max, 30);
            println!("    {:<40} {:>6}  {bar}", rule, count);
        }
    }
}

/// Print misdetection analysis
fn print_misdetections(c: &Colors, summary: &MisdetectionSummary) {
    println!("{}=== Misdetection Analysis ==={}", c.bold, c.reset);
    println!(
        "  {}(UserInputDuringProcessing events — user input while agent detected as Processing){}",
        c.dim, c.reset
    );
    println!();
    println!("  {}Total events:{} {}", c.bold, c.reset, summary.total);
    println!();

    if summary.total == 0 {
        println!("  {}No misdetection signals found.{}", c.green, c.reset);
        return;
    }

    // By rule
    println!("  {}By detection rule at time of input:{}", c.bold, c.reset);
    let rule_max = summary.by_rule.first().map(|(_, n)| *n).unwrap_or(1);
    for (rule, count) in &summary.by_rule {
        let bar = make_bar(c, *count, rule_max, 30);
        println!("    {:<40} {:>6}  {bar}", rule, count);
    }
    println!();

    // Individual records
    if !summary.records.is_empty() {
        println!(
            "  {}Recent records (newest first, showing {}):{}",
            c.bold,
            summary.records.len(),
            c.reset
        );
        println!(
            "  {}{:<22} {:<10} {:<15} {:<20} {:<15} {:<15}{}",
            c.dim, "Timestamp", "Pane", "Agent", "Rule", "Action", "Source", c.reset
        );
        for record in &summary.records {
            print_misdetection_record(c, record);
        }
    }
}

/// Print a single misdetection record
fn print_misdetection_record(c: &Colors, record: &MisdetectionRecord) {
    let ts = format_timestamp(record.ts);
    println!(
        "  {:<22} {:<10} {:<15} {}{:<20}{} {:<15} {}{:<15}{}",
        ts,
        record.pane_id,
        record.agent_type,
        c.yellow,
        record.rule,
        c.reset,
        record.action,
        c.dim,
        record.input_source,
        c.reset,
    );
}

/// Print disagreement analysis
fn print_disagreements(c: &Colors, summary: &DisagreementSummary) {
    println!("{}=== Source Disagreement Analysis ==={}", c.bold, c.reset);
    println!(
        "  {}(IPC and capture-pane detected different statuses){}",
        c.dim, c.reset
    );
    println!();
    println!("  {}Total events:{} {}", c.bold, c.reset, summary.total);
    println!();

    if summary.total == 0 {
        println!("  {}No source disagreements found.{}", c.green, c.reset);
        return;
    }

    // By capture rule
    println!("  {}By capture-pane rule:{}", c.bold, c.reset);
    let rule_max = summary
        .by_capture_rule
        .first()
        .map(|(_, n)| *n)
        .unwrap_or(1);
    for (rule, count) in &summary.by_capture_rule {
        let bar = make_bar(c, *count, rule_max, 30);
        println!("    {:<40} {:>6}  {bar}", rule, count);
    }
    println!();

    // By pane
    println!("  {}By pane:{}", c.bold, c.reset);
    for (pane, count) in &summary.by_pane {
        println!("    {:<20} {:>6}", pane, count);
    }
    println!();

    // Individual records
    if !summary.records.is_empty() {
        println!(
            "  {}Recent records (newest first, showing {}):{}",
            c.bold,
            summary.records.len(),
            c.reset
        );
        println!(
            "  {}{:<22} {:<10} {:<15} {:<15} {:<15} {:<25}{}",
            c.dim, "Timestamp", "Pane", "Agent", "IPC", "Capture", "Capture Rule", c.reset
        );
        for record in &summary.records {
            print_disagreement_record(c, record);
        }
    }
}

/// Print a single disagreement record
fn print_disagreement_record(c: &Colors, record: &DisagreementRecord) {
    let ts = format_timestamp(record.ts);
    println!(
        "  {:<22} {:<10} {:<15} {}{:<15}{} {}{:<15}{} {}{:<25}{}",
        ts,
        record.pane_id,
        record.agent_type,
        c.cyan,
        record.ipc_status,
        c.reset,
        c.red,
        record.capture_status,
        c.reset,
        c.magenta,
        record.capture_rule,
        c.reset,
    );
}

/// Format a millisecond timestamp to local time string
fn format_timestamp(ts_ms: u64) -> String {
    use chrono::{DateTime, Local};
    DateTime::from_timestamp_millis(ts_ms as i64)
        .map(|dt| {
            dt.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|| format!("{}ms", ts_ms))
}

/// Create a simple bar chart
fn make_bar(c: &Colors, value: usize, max: usize, width: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let filled = (value * width) / max;
    let filled = filled.max(1); // at least 1 char for non-zero values
    format!("{}{}{}", c.dim, "█".repeat(filled), c.reset)
}
