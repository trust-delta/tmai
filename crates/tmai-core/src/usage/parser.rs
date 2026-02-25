//! Parse Claude Code `/usage` output from captured tmux pane content.

use super::types::{UsageMeter, UsageSnapshot};

/// Parse `/usage` output from tmux capture-pane plain text.
///
/// Expected format (each meter block):
/// ```text
///   Current session
///   ████████████████████████████████████               72% used
///   Resets 1am (Asia/Tokyo)
///
///   Current week (all models)
///   ███████████▌                                       23% used
///   Resets Mar 3, 12am (Asia/Tokyo)
/// ```
pub fn parse_usage_output(text: &str) -> UsageSnapshot {
    let lines: Vec<&str> = text.lines().collect();
    let mut meters = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        // Look for "N% used" pattern — this is the bar line
        if let Some(percent) = extract_percent(line) {
            // The label is on the line above the bar
            let label = if i > 0 {
                lines[i - 1].trim().to_string()
            } else {
                "Unknown".to_string()
            };

            // Skip "Settings:" header line and tab-like labels
            if label.starts_with("Settings:") || label.is_empty() {
                i += 1;
                continue;
            }

            // Look for reset_info and spending on lines after the bar
            let mut reset_info = None;
            let mut spending = None;

            // Check next lines for metadata
            let mut j = i + 1;
            while j < lines.len() {
                let next_line = lines[j].trim();
                if next_line.is_empty() {
                    break;
                }
                if next_line.contains('·') && next_line.contains("Resets ") {
                    // Combined line: "$22.22 / $50.00 spent · Resets Mar 1 (Asia/Tokyo)"
                    if let Some((spend, reset)) = next_line.split_once('·') {
                        spending = Some(spend.trim().to_string());
                        reset_info = Some(reset.trim().to_string());
                    }
                } else if next_line.starts_with("Resets ") {
                    reset_info = Some(next_line.to_string());
                } else if next_line.contains('$') && next_line.contains("spent") {
                    spending = Some(next_line.to_string());
                }
                j += 1;
            }

            meters.push(UsageMeter {
                label,
                percent,
                reset_info,
                spending,
            });
        }

        i += 1;
    }

    UsageSnapshot {
        meters,
        fetched_at: Some(chrono::Utc::now()),
        fetching: false,
        error: None,
    }
}

/// Extract percentage from a line containing "N% used"
fn extract_percent(line: &str) -> Option<u8> {
    // Find "N% used" pattern
    let idx = line.find("% used")?;
    // Walk backwards from "% used" to find the number
    let before = &line[..idx];
    let num_str: String = before
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if num_str.is_empty() {
        return None;
    }
    let num_str: String = num_str.chars().rev().collect();
    num_str.parse::<u8>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_usage_output() {
        let text = r#"
 Settings:  Status   Config   Usage  (←/→ or tab to cycle)


  Current session
  ████████████████████████████████████               72% used
  Resets 1am (Asia/Tokyo)

  Current week (all models)
  ███████████▌                                       23% used
  Resets Mar 3, 12am (Asia/Tokyo)

  Current week (Sonnet only)
                                                     0% used

  Extra usage
  ██████████████████████▏                            44% used
  $22.22 / $50.00 spent · Resets Mar 1 (Asia/Tokyo)

  Esc to cancel
"#;

        let snapshot = parse_usage_output(text);
        assert_eq!(snapshot.meters.len(), 4);

        assert_eq!(snapshot.meters[0].label, "Current session");
        assert_eq!(snapshot.meters[0].percent, 72);
        assert_eq!(
            snapshot.meters[0].reset_info.as_deref(),
            Some("Resets 1am (Asia/Tokyo)")
        );

        assert_eq!(snapshot.meters[1].label, "Current week (all models)");
        assert_eq!(snapshot.meters[1].percent, 23);

        assert_eq!(snapshot.meters[2].label, "Current week (Sonnet only)");
        assert_eq!(snapshot.meters[2].percent, 0);
        assert!(snapshot.meters[2].reset_info.is_none());

        assert_eq!(snapshot.meters[3].label, "Extra usage");
        assert_eq!(snapshot.meters[3].percent, 44);
        assert!(snapshot.meters[3].spending.is_some());
        assert!(snapshot.meters[3].reset_info.is_some());
    }

    #[test]
    fn test_extract_percent() {
        assert_eq!(extract_percent("  72% used"), Some(72));
        assert_eq!(extract_percent("0% used"), Some(0));
        assert_eq!(
            extract_percent("  ████████████████████████████████████               72% used"),
            Some(72)
        );
        assert_eq!(extract_percent("no match here"), None);
        assert_eq!(extract_percent("100% used"), Some(100));
    }

    #[test]
    fn test_empty_input() {
        let snapshot = parse_usage_output("");
        assert!(snapshot.meters.is_empty());
    }
}
