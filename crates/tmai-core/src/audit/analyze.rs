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
    rule_hits.sort_by_key(|x| std::cmp::Reverse(x.1));
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
    by_rule.sort_by_key(|x| std::cmp::Reverse(x.1));
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
    by_capture_rule.sort_by_key(|x| std::cmp::Reverse(x.1));
    summary.by_capture_rule = by_capture_rule;

    let mut by_pane: Vec<(String, usize)> = pane_map.into_iter().collect();
    by_pane.sort_by_key(|x| std::cmp::Reverse(x.1));
    summary.by_pane = by_pane;

    // Most recent first, limited
    records.reverse();
    records.truncate(limit);
    summary.records = records;

    summary
}

/// Accuracy stats per hook status (e.g., "processing", "idle")
#[derive(Debug, Default)]
pub struct StatusAccuracy {
    /// Total validation events for this hook status
    pub total: usize,
    /// Number of IPC agreements
    pub ipc_agree: usize,
    /// Total IPC comparisons (excluding None)
    pub ipc_total: usize,
    /// Number of capture-pane agreements
    pub capture_agree: usize,
}

/// Summary of DetectionValidation events (hook vs IPC/capture-pane accuracy)
#[derive(Debug, Default)]
pub struct ValidationSummary {
    /// Total validation events (disagreements only)
    pub total: usize,
    /// Number of IPC agreements
    pub ipc_agreement_count: usize,
    /// Total IPC comparisons (excluding None)
    pub ipc_total: usize,
    /// Number of capture-pane agreements
    pub capture_agreement_count: usize,
    /// Capture-pane disagreement frequency by rule name
    pub capture_disagreements_by_rule: Vec<(String, usize)>,
    /// Accuracy breakdown by hook status
    pub by_hook_status: HashMap<String, StatusAccuracy>,
}

/// Compute validation statistics from DetectionValidation events
pub fn compute_validation_stats(events: &[AuditEvent]) -> ValidationSummary {
    let mut summary = ValidationSummary::default();
    let mut rule_map: HashMap<String, usize> = HashMap::new();

    for event in events {
        if let AuditEvent::DetectionValidation {
            hook_status,
            capture_reason,
            ipc_agrees,
            capture_agrees,
            ..
        } = event
        {
            summary.total += 1;

            let entry = summary
                .by_hook_status
                .entry(hook_status.clone())
                .or_default();
            entry.total += 1;

            // IPC stats
            if let Some(agrees) = ipc_agrees {
                summary.ipc_total += 1;
                entry.ipc_total += 1;
                if *agrees {
                    summary.ipc_agreement_count += 1;
                    entry.ipc_agree += 1;
                }
            }

            // capture-pane stats
            if *capture_agrees {
                summary.capture_agreement_count += 1;
                entry.capture_agree += 1;
            } else {
                // Track which capture rules disagree
                *rule_map.entry(capture_reason.rule.clone()).or_default() += 1;
            }
        }
    }

    // Sort rules by frequency descending
    let mut by_rule: Vec<(String, usize)> = rule_map.into_iter().collect();
    by_rule.sort_by_key(|x| std::cmp::Reverse(x.1));
    summary.capture_disagreements_by_rule = by_rule;

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
        | AuditEvent::DetectionValidation { ts, .. }
        | AuditEvent::PermissionDenied { ts, .. }
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
        AuditEvent::DetectionValidation { .. } => "DetectionValidation",
        AuditEvent::PermissionDenied { .. } => "PermissionDenied",
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
        | AuditEvent::DetectionValidation { agent_type, .. }
        | AuditEvent::PermissionDenied { agent_type, .. }
        | AuditEvent::UserInputDuringProcessing { agent_type, .. } => agent_type,
    }
}

/// Get detection reason if the event has one
fn event_reason(event: &AuditEvent) -> Option<&crate::detectors::DetectionReason> {
    match event {
        AuditEvent::StateChanged { reason, .. } => Some(reason),
        AuditEvent::SourceDisagreement { capture_reason, .. } => Some(capture_reason),
        AuditEvent::DetectionValidation { capture_reason, .. } => Some(capture_reason),
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
    use crate::hooks::types::PermissionMode;

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

    /// Helper to build a DetectionValidation event
    fn validation_event(
        hook_status: &str,
        ipc_status: Option<&str>,
        capture_status: &str,
        capture_rule: &str,
    ) -> AuditEvent {
        let ipc_agrees = ipc_status.map(|s| s == hook_status);
        let capture_agrees = capture_status == hook_status;
        AuditEvent::DetectionValidation {
            ts: 1000,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            hook_status: hook_status.to_string(),
            hook_event: "PreToolUse".to_string(),
            ipc_status: ipc_status.map(|s| s.to_string()),
            capture_status: capture_status.to_string(),
            capture_reason: DetectionReason {
                rule: capture_rule.to_string(),
                confidence: DetectionConfidence::Medium,
                matched_text: None,
            },
            ipc_agrees,
            capture_agrees,
            hook_tool_input: None,
            hook_permission_mode: None,
            screen_context: None,
        }
    }

    #[test]
    fn test_compute_validation_stats_empty() {
        let summary = compute_validation_stats(&[]);
        assert_eq!(summary.total, 0);
        assert_eq!(summary.ipc_total, 0);
        assert_eq!(summary.capture_agreement_count, 0);
    }

    #[test]
    fn test_compute_validation_stats_capture_disagree() {
        let events = vec![
            // capture disagrees: hook=processing, capture=idle
            validation_event("processing", None, "idle", "no_spinner"),
            // capture disagrees again: hook=idle, capture=processing
            validation_event("idle", None, "processing", "spinner_verb"),
        ];

        let summary = compute_validation_stats(&events);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.capture_agreement_count, 0);
        assert_eq!(summary.ipc_total, 0);
        assert_eq!(summary.ipc_agreement_count, 0);

        // Both rules should appear in disagreements
        assert_eq!(summary.capture_disagreements_by_rule.len(), 2);

        // By hook status
        assert_eq!(summary.by_hook_status["processing"].total, 1);
        assert_eq!(summary.by_hook_status["processing"].capture_agree, 0);
        assert_eq!(summary.by_hook_status["idle"].total, 1);
        assert_eq!(summary.by_hook_status["idle"].capture_agree, 0);
    }

    #[test]
    fn test_compute_validation_stats_with_ipc() {
        let events = vec![
            // IPC agrees, capture disagrees
            validation_event("processing", Some("processing"), "idle", "no_spinner"),
            // IPC disagrees, capture disagrees
            validation_event("processing", Some("idle"), "idle", "fallback_no_indicator"),
        ];

        let summary = compute_validation_stats(&events);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.ipc_total, 2);
        assert_eq!(summary.ipc_agreement_count, 1);
        assert_eq!(summary.capture_agreement_count, 0);

        let status_acc = &summary.by_hook_status["processing"];
        assert_eq!(status_acc.total, 2);
        assert_eq!(status_acc.ipc_total, 2);
        assert_eq!(status_acc.ipc_agree, 1);
        assert_eq!(status_acc.capture_agree, 0);
    }

    #[test]
    fn test_compute_validation_stats_mixed_events() {
        // Mix validation events with other event types
        let events = vec![
            state_changed(1000, "rule_a", DetectionConfidence::High),
            validation_event("processing", Some("processing"), "idle", "no_spinner"),
            AuditEvent::AgentAppeared {
                ts: 500,
                pane_id: "1".to_string(),
                agent_type: "ClaudeCode".to_string(),
                source: "capture_pane".to_string(),
                initial_status: "idle".to_string(),
            },
        ];

        let summary = compute_validation_stats(&events);
        // Only 1 validation event
        assert_eq!(summary.total, 1);
        assert_eq!(summary.ipc_total, 1);
        assert_eq!(summary.ipc_agreement_count, 1);
    }

    #[test]
    fn test_compute_stats_includes_permission_denied() {
        let events = vec![
            AuditEvent::PermissionDenied {
                ts: 5000,
                pane_id: "1".to_string(),
                agent_type: "ClaudeCode".to_string(),
                tool_name: Some("Bash".to_string()),
                tool_input: Some(serde_json::json!({"command": "rm -rf /"})),
                permission_mode: Some(PermissionMode::Default),
            },
            state_changed(1000, "rule_a", DetectionConfidence::High),
        ];

        let stats = compute_stats(&events);
        assert_eq!(stats.total_events, 2);
        assert_eq!(stats.by_event_type["PermissionDenied"], 1);
        assert_eq!(stats.by_event_type["StateChanged"], 1);
        assert_eq!(stats.ts_min, Some(1000));
        assert_eq!(stats.ts_max, Some(5000));
    }

    #[test]
    fn test_compute_stats_includes_validation() {
        let events = vec![validation_event("processing", None, "idle", "no_spinner")];

        let stats = compute_stats(&events);
        assert_eq!(stats.total_events, 1);
        assert_eq!(stats.by_event_type["DetectionValidation"], 1);
        // capture_reason should be counted
        assert_eq!(stats.by_confidence[&DetectionConfidence::Medium], 1);
        assert_eq!(stats.rule_hits[0], ("no_spinner".to_string(), 1));
    }
}
