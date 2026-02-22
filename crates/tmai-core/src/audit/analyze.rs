//! Pure analysis functions for audit events (no I/O, easy to test)

use std::collections::HashMap;

use crate::detectors::DetectionConfidence;

use super::events::AuditEvent;

/// Aggregated statistics from audit events
#[derive(Debug, Default)]
pub struct AuditStats {
    /// Total event count
    pub total_events: usize,
    /// Event count by type (e.g., "StateChanged" → 42)
    pub by_event_type: HashMap<String, usize>,
    /// Count by detection confidence level
    pub by_confidence: HashMap<DetectionConfidence, usize>,
    /// Rule hit count (rule name → count), sorted descending by count
    pub rule_hits: Vec<(String, usize)>,
    /// Count by agent type
    pub by_agent_type: HashMap<String, usize>,
    /// Earliest timestamp (ms since epoch)
    pub ts_min: Option<u64>,
    /// Latest timestamp (ms since epoch)
    pub ts_max: Option<u64>,
}

/// Summary of UserInputDuringProcessing events (possible misdetections)
#[derive(Debug, Default)]
pub struct MisdetectionSummary {
    /// Total misdetection events
    pub total: usize,
    /// Frequency by detection rule at the time of input
    pub by_rule: Vec<(String, usize)>,
    /// Individual records (most recent first, limited by caller)
    pub records: Vec<MisdetectionRecord>,
}

/// A single misdetection record
#[derive(Debug)]
pub struct MisdetectionRecord {
    pub ts: u64,
    pub pane_id: String,
    pub agent_type: String,
    pub action: String,
    pub input_source: String,
    pub rule: String,
    pub detection_source: String,
}

/// Summary of SourceDisagreement events
#[derive(Debug, Default)]
pub struct DisagreementSummary {
    /// Total disagreement events
    pub total: usize,
    /// Frequency by capture rule (rule that disagreed with IPC)
    pub by_capture_rule: Vec<(String, usize)>,
    /// Frequency by pane_id
    pub by_pane: Vec<(String, usize)>,
    /// Individual records (most recent first, limited by caller)
    pub records: Vec<DisagreementRecord>,
}

/// A single disagreement record
#[derive(Debug)]
pub struct DisagreementRecord {
    pub ts: u64,
    pub pane_id: String,
    pub agent_type: String,
    pub ipc_status: String,
    pub capture_status: String,
    pub capture_rule: String,
}

/// Compute aggregate statistics from audit events
pub fn compute_stats(events: &[AuditEvent]) -> AuditStats {
    let mut stats = AuditStats {
        total_events: events.len(),
        ..Default::default()
    };

    let mut rule_map: HashMap<String, usize> = HashMap::new();

    for event in events {
        let ts = event_ts(event);

        // Update time range
        stats.ts_min = Some(stats.ts_min.map_or(ts, |min| min.min(ts)));
        stats.ts_max = Some(stats.ts_max.map_or(ts, |max| max.max(ts)));

        // Count by event type
        let event_type = event_type_name(event);
        *stats
            .by_event_type
            .entry(event_type.to_string())
            .or_default() += 1;

        // Count by agent type
        let agent_type = event_agent_type(event);
        *stats
            .by_agent_type
            .entry(agent_type.to_string())
            .or_default() += 1;

        // Count by confidence and rule (for events that have DetectionReason)
        if let Some(reason) = event_reason(event) {
            *stats.by_confidence.entry(reason.confidence).or_default() += 1;
            *rule_map.entry(reason.rule.clone()).or_default() += 1;
        }
    }

    // Sort rules by count descending
    let mut rule_hits: Vec<(String, usize)> = rule_map.into_iter().collect();
    rule_hits.sort_by(|a, b| b.1.cmp(&a.1));
    stats.rule_hits = rule_hits;

    stats
}

/// Extract misdetection events (UserInputDuringProcessing)
pub fn compute_misdetections(events: &[AuditEvent], limit: usize) -> MisdetectionSummary {
    let mut summary = MisdetectionSummary::default();
    let mut rule_map: HashMap<String, usize> = HashMap::new();
    let mut records = Vec::new();

    for event in events {
        if let AuditEvent::UserInputDuringProcessing {
            ts,
            pane_id,
            agent_type,
            action,
            input_source,
            detection_reason,
            detection_source,
            ..
        } = event
        {
            summary.total += 1;

            let rule = detection_reason
                .as_ref()
                .map(|r| r.rule.clone())
                .unwrap_or_else(|| "unknown".to_string());

            *rule_map.entry(rule.clone()).or_default() += 1;

            records.push(MisdetectionRecord {
                ts: *ts,
                pane_id: pane_id.clone(),
                agent_type: agent_type.clone(),
                action: action.clone(),
                input_source: input_source.clone(),
                rule,
                detection_source: detection_source.clone(),
            });
        }
    }

    // Sort rules by frequency descending
    let mut by_rule: Vec<(String, usize)> = rule_map.into_iter().collect();
    by_rule.sort_by(|a, b| b.1.cmp(&a.1));
    summary.by_rule = by_rule;

    // Most recent first, limited
    records.reverse();
    records.truncate(limit);
    summary.records = records;

    summary
}

/// Extract SourceDisagreement events
pub fn compute_disagreements(events: &[AuditEvent], limit: usize) -> DisagreementSummary {
    let mut summary = DisagreementSummary::default();
    let mut rule_map: HashMap<String, usize> = HashMap::new();
    let mut pane_map: HashMap<String, usize> = HashMap::new();
    let mut records = Vec::new();

    for event in events {
        if let AuditEvent::SourceDisagreement {
            ts,
            pane_id,
            agent_type,
            ipc_status,
            capture_status,
            capture_reason,
            ..
        } = event
        {
            summary.total += 1;

            *rule_map.entry(capture_reason.rule.clone()).or_default() += 1;
            *pane_map.entry(pane_id.clone()).or_default() += 1;

            records.push(DisagreementRecord {
                ts: *ts,
                pane_id: pane_id.clone(),
                agent_type: agent_type.clone(),
                ipc_status: ipc_status.clone(),
                capture_status: capture_status.clone(),
                capture_rule: capture_reason.rule.clone(),
            });
        }
    }

    // Sort by frequency descending
    let mut by_capture_rule: Vec<(String, usize)> = rule_map.into_iter().collect();
    by_capture_rule.sort_by(|a, b| b.1.cmp(&a.1));
    summary.by_capture_rule = by_capture_rule;

    let mut by_pane: Vec<(String, usize)> = pane_map.into_iter().collect();
    by_pane.sort_by(|a, b| b.1.cmp(&a.1));
    summary.by_pane = by_pane;

    // Most recent first, limited
    records.reverse();
    records.truncate(limit);
    summary.records = records;

    summary
}

/// Extract timestamp from any event variant
fn event_ts(event: &AuditEvent) -> u64 {
    match event {
        AuditEvent::StateChanged { ts, .. }
        | AuditEvent::SourceDisagreement { ts, .. }
        | AuditEvent::AgentAppeared { ts, .. }
        | AuditEvent::AgentDisappeared { ts, .. }
        | AuditEvent::AutoApproveJudgment { ts, .. }
        | AuditEvent::UserInputDuringProcessing { ts, .. } => *ts,
    }
}

/// Get event type name as a string
fn event_type_name(event: &AuditEvent) -> &'static str {
    match event {
        AuditEvent::StateChanged { .. } => "StateChanged",
        AuditEvent::SourceDisagreement { .. } => "SourceDisagreement",
        AuditEvent::AgentAppeared { .. } => "AgentAppeared",
        AuditEvent::AgentDisappeared { .. } => "AgentDisappeared",
        AuditEvent::AutoApproveJudgment { .. } => "AutoApproveJudgment",
        AuditEvent::UserInputDuringProcessing { .. } => "UserInputDuringProcessing",
    }
}

/// Get agent_type from any event variant
fn event_agent_type(event: &AuditEvent) -> &str {
    match event {
        AuditEvent::StateChanged { agent_type, .. }
        | AuditEvent::SourceDisagreement { agent_type, .. }
        | AuditEvent::AgentAppeared { agent_type, .. }
        | AuditEvent::AgentDisappeared { agent_type, .. }
        | AuditEvent::AutoApproveJudgment { agent_type, .. }
        | AuditEvent::UserInputDuringProcessing { agent_type, .. } => agent_type,
    }
}

/// Get detection reason if the event has one
fn event_reason(event: &AuditEvent) -> Option<&crate::detectors::DetectionReason> {
    match event {
        AuditEvent::StateChanged { reason, .. } => Some(reason),
        AuditEvent::SourceDisagreement { capture_reason, .. } => Some(capture_reason),
        AuditEvent::UserInputDuringProcessing {
            detection_reason, ..
        } => detection_reason.as_ref(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detectors::{DetectionConfidence, DetectionReason};

    /// Helper to build a StateChanged event
    fn state_changed(ts: u64, rule: &str, confidence: DetectionConfidence) -> AuditEvent {
        AuditEvent::StateChanged {
            ts,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            source: "capture_pane".to_string(),
            prev_status: "idle".to_string(),
            new_status: "processing".to_string(),
            reason: DetectionReason {
                rule: rule.to_string(),
                confidence,
                matched_text: None,
            },
            screen_context: None,
            prev_state_duration_ms: None,
            approval_type: None,
            approval_details: None,
        }
    }

    #[test]
    fn test_compute_stats_empty() {
        let stats = compute_stats(&[]);
        assert_eq!(stats.total_events, 0);
        assert!(stats.by_event_type.is_empty());
        assert!(stats.rule_hits.is_empty());
        assert!(stats.ts_min.is_none());
    }

    #[test]
    fn test_compute_stats_counts() {
        let events = vec![
            state_changed(1000, "rule_a", DetectionConfidence::High),
            state_changed(2000, "rule_a", DetectionConfidence::High),
            state_changed(3000, "rule_b", DetectionConfidence::Medium),
            AuditEvent::AgentAppeared {
                ts: 500,
                pane_id: "1".to_string(),
                agent_type: "ClaudeCode".to_string(),
                source: "capture_pane".to_string(),
                initial_status: "idle".to_string(),
            },
        ];

        let stats = compute_stats(&events);

        assert_eq!(stats.total_events, 4);
        assert_eq!(stats.by_event_type["StateChanged"], 3);
        assert_eq!(stats.by_event_type["AgentAppeared"], 1);
        assert_eq!(stats.by_confidence[&DetectionConfidence::High], 2);
        assert_eq!(stats.by_confidence[&DetectionConfidence::Medium], 1);
        assert_eq!(stats.ts_min, Some(500));
        assert_eq!(stats.ts_max, Some(3000));

        // Rule hits sorted descending
        assert_eq!(stats.rule_hits[0], ("rule_a".to_string(), 2));
        assert_eq!(stats.rule_hits[1], ("rule_b".to_string(), 1));
    }

    #[test]
    fn test_compute_misdetections_empty() {
        let summary = compute_misdetections(&[], 50);
        assert_eq!(summary.total, 0);
        assert!(summary.records.is_empty());
    }

    #[test]
    fn test_compute_misdetections_filters_and_limits() {
        let events = vec![
            state_changed(1000, "rule_a", DetectionConfidence::High),
            AuditEvent::UserInputDuringProcessing {
                ts: 2000,
                pane_id: "1".to_string(),
                agent_type: "ClaudeCode".to_string(),
                action: "input_text".to_string(),
                input_source: "tui_input_mode".to_string(),
                current_status: "processing".to_string(),
                detection_reason: Some(DetectionReason {
                    rule: "spinner_verb".to_string(),
                    confidence: DetectionConfidence::Medium,
                    matched_text: None,
                }),
                detection_source: "capture_pane".to_string(),
                screen_context: None,
            },
            AuditEvent::UserInputDuringProcessing {
                ts: 3000,
                pane_id: "2".to_string(),
                agent_type: "ClaudeCode".to_string(),
                action: "passthrough_key".to_string(),
                input_source: "tui_passthrough".to_string(),
                current_status: "processing".to_string(),
                detection_reason: Some(DetectionReason {
                    rule: "spinner_verb".to_string(),
                    confidence: DetectionConfidence::Medium,
                    matched_text: None,
                }),
                detection_source: "ipc_socket".to_string(),
                screen_context: None,
            },
        ];

        let summary = compute_misdetections(&events, 50);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.by_rule[0], ("spinner_verb".to_string(), 2));

        // Most recent first
        assert_eq!(summary.records[0].ts, 3000);
        assert_eq!(summary.records[1].ts, 2000);

        // Test limit=1
        let limited = compute_misdetections(&events, 1);
        assert_eq!(limited.total, 2); // total is still 2
        assert_eq!(limited.records.len(), 1);
    }

    #[test]
    fn test_compute_disagreements() {
        let events = vec![
            AuditEvent::SourceDisagreement {
                ts: 1000,
                pane_id: "1".to_string(),
                agent_type: "ClaudeCode".to_string(),
                ipc_status: "processing".to_string(),
                capture_status: "idle".to_string(),
                capture_reason: DetectionReason {
                    rule: "no_spinner".to_string(),
                    confidence: DetectionConfidence::Low,
                    matched_text: None,
                },
                screen_context: None,
            },
            state_changed(2000, "rule_a", DetectionConfidence::High),
        ];

        let summary = compute_disagreements(&events, 50);
        assert_eq!(summary.total, 1);
        assert_eq!(summary.by_capture_rule[0], ("no_spinner".to_string(), 1));
        assert_eq!(summary.by_pane[0], ("1".to_string(), 1));
        assert_eq!(summary.records.len(), 1);
    }
}
