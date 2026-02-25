//! Compact usage bar widget displayed below the agent list.

use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph},
    Frame,
};

use tmai_core::usage::UsageSnapshot;

/// Fixed label width for alignment (longest label "Session" = 7 chars)
const LABEL_WIDTH: usize = 7;

/// Compact usage bar widget
pub struct UsageBar;

impl UsageBar {
    /// Calculate the height needed for the usage bar (0 if no data)
    pub fn height(snapshot: &UsageSnapshot) -> u16 {
        if snapshot.meters.is_empty() && snapshot.error.is_none() && !snapshot.fetching {
            return 0;
        }
        // 2 (top/bottom border) + meter rows
        let content_rows = if snapshot.fetching || snapshot.error.is_some() {
            1
        } else {
            snapshot.meters.len() as u16
        };
        content_rows + 2
    }

    /// Render the usage bar
    pub fn render(frame: &mut Frame, area: Rect, snapshot: &UsageSnapshot) {
        if area.height < 3 || area.width < 10 {
            return;
        }

        let title = Self::build_title(snapshot);
        let block = Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Gray));

        let inner = block.inner(area);
        frame.render_widget(block, area);

        if snapshot.fetching {
            let line = Line::from(Span::styled(
                " Fetching usage...",
                Style::default().fg(Color::DarkGray),
            ));
            frame.render_widget(Paragraph::new(vec![line]), inner);
            return;
        }

        if let Some(ref err) = snapshot.error {
            let line = Line::from(Span::styled(
                format!(" Error: {}", err),
                Style::default().fg(Color::Red),
            ));
            frame.render_widget(Paragraph::new(vec![line]), inner);
            return;
        }

        // Pre-compute reset strings and find max width for uniform bar sizing
        let reset_strs: Vec<String> = snapshot
            .meters
            .iter()
            .map(|m| {
                m.reset_info
                    .as_ref()
                    .map(|r| Self::compact_reset(r))
                    .unwrap_or_default()
            })
            .collect();
        let max_reset_width = reset_strs.iter().map(|s| s.len()).max().unwrap_or(0);

        let lines: Vec<Line> = snapshot
            .meters
            .iter()
            .zip(reset_strs.iter())
            .enumerate()
            .filter_map(|(i, (meter, reset_str))| {
                if i as u16 >= inner.height {
                    return None;
                }
                Some(Self::render_meter_line(
                    meter,
                    inner.width,
                    reset_str,
                    max_reset_width,
                ))
            })
            .collect();

        frame.render_widget(Paragraph::new(lines), inner);
    }

    /// Build the block title with optional timestamp
    fn build_title(snapshot: &UsageSnapshot) -> String {
        if let Some(fetched_at) = snapshot.fetched_at {
            let local = fetched_at.with_timezone(&chrono::Local);
            format!(" Usage ({}) ", local.format("%H:%M"))
        } else {
            " Usage ".to_string()
        }
    }

    /// Render a single meter with uniform bar width across all rows:
    /// " Session ████████░░░░░  79%       1am"
    fn render_meter_line(
        meter: &tmai_core::usage::UsageMeter,
        width: u16,
        reset_str: &str,
        max_reset_width: usize,
    ) -> Line<'static> {
        let label = Self::compact_label(&meter.label);
        let padded_label = format!("{:w$}", label, w = LABEL_WIDTH);
        let percent_str = format!("{:>3}%", meter.percent);

        // Use max_reset_width for uniform bar sizing across all rows
        let reset_col_width = if max_reset_width > 0 {
            max_reset_width + 1
        } else {
            0
        };
        // " Label   ████░░░░ 100% reset_col"
        let fixed_width = 1 + LABEL_WIDTH + 1 + 1 + 4 + 1 + reset_col_width;
        let bar_width = if width as usize > fixed_width + 4 {
            width as usize - fixed_width
        } else {
            4
        };

        let filled = (bar_width as u32 * meter.percent as u32 / 100) as usize;
        let empty = bar_width.saturating_sub(filled);

        let dim = Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM);

        let mut spans = vec![
            Span::styled(
                format!(" {} ", padded_label),
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::DIM),
            ),
            Span::styled("█".repeat(filled), Style::default().fg(Color::Gray)),
            Span::styled("░".repeat(empty), dim),
            Span::styled(
                format!(" {}", percent_str),
                Style::default().fg(Color::White),
            ),
        ];

        // Right-pad reset string to max_reset_width for column alignment
        if max_reset_width > 0 {
            let padded_reset = format!(" {:w$}", reset_str, w = max_reset_width);
            spans.push(Span::styled(
                padded_reset,
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::DIM),
            ));
        }

        Line::from(spans)
    }

    /// Shorten label for compact display
    fn compact_label(label: &str) -> String {
        match label {
            "Current session" => "Session".to_string(),
            "Current week (all models)" => "Week".to_string(),
            "Current week (Sonnet only)" => "Sonnet".to_string(),
            "Extra usage" => "Extra".to_string(),
            other => {
                if other.starts_with("Current week") {
                    other
                        .strip_prefix("Current week (")
                        .and_then(|s| s.strip_suffix(')'))
                        .unwrap_or(other)
                        .to_string()
                } else {
                    other.to_string()
                }
            }
        }
    }

    /// Shorten reset info for compact display
    fn compact_reset(reset: &str) -> String {
        // "Resets 1am (Asia/Tokyo)" -> "1am"
        // "Resets Mar 3, 12am (Asia/Tokyo)" -> "Mar 3"
        reset
            .strip_prefix("Resets ")
            .map(|s| {
                if let Some(idx) = s.find(" (") {
                    s[..idx].to_string()
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_else(|| reset.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tmai_core::usage::UsageMeter;

    #[test]
    fn test_compact_label() {
        assert_eq!(UsageBar::compact_label("Current session"), "Session");
        assert_eq!(UsageBar::compact_label("Current week (all models)"), "Week");
        assert_eq!(
            UsageBar::compact_label("Current week (Sonnet only)"),
            "Sonnet"
        );
        assert_eq!(UsageBar::compact_label("Extra usage"), "Extra");
    }

    #[test]
    fn test_compact_reset() {
        assert_eq!(UsageBar::compact_reset("Resets 1am (Asia/Tokyo)"), "1am");
        assert_eq!(
            UsageBar::compact_reset("Resets Mar 3, 12am (Asia/Tokyo)"),
            "Mar 3, 12am"
        );
    }

    #[test]
    fn test_height_empty() {
        let snapshot = UsageSnapshot::default();
        assert_eq!(UsageBar::height(&snapshot), 0);
    }

    #[test]
    fn test_height_with_meters() {
        let snapshot = UsageSnapshot {
            meters: vec![
                UsageMeter {
                    label: "Session".to_string(),
                    percent: 50,
                    reset_info: None,
                    spending: None,
                },
                UsageMeter {
                    label: "Week".to_string(),
                    percent: 20,
                    reset_info: None,
                    spending: None,
                },
            ],
            fetched_at: None,
            fetching: false,
            error: None,
        };
        assert_eq!(UsageBar::height(&snapshot), 4); // 2 meters + 2 border
    }
}
