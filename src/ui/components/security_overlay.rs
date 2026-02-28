//! Full-screen overlay showing security scan results.

use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
    },
    Frame,
};

use tmai_core::security::{ScanResult, Severity};
use tmai_core::state::AppState;

/// Full-screen overlay showing security scan results
pub struct SecurityOverlay;

impl SecurityOverlay {
    /// Render the security overlay (full screen, like TeamOverview)
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let content_lines = Self::build_content(state);
        let total_lines = content_lines.len();

        // Calculate visible area (subtract 2 for border)
        let visible_height = area.height.saturating_sub(2) as usize;

        // Clamp scroll to valid range
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = (state.view.security_overlay_scroll as usize).min(max_scroll);

        let block = Block::default()
            .title(" Security Monitor (j/k to scroll, R to rescan, S or Esc to close) ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        let paragraph = Paragraph::new(content_lines)
            .block(block)
            .scroll((scroll as u16, 0));

        frame.render_widget(paragraph, area);

        // Render scrollbar
        if total_lines > visible_height {
            let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("\u{2191}"))
                .end_symbol(Some("\u{2193}"));

            let mut scrollbar_state = ScrollbarState::new(max_scroll).position(scroll);

            frame.render_stateful_widget(
                scrollbar,
                area.inner(ratatui::layout::Margin {
                    vertical: 1,
                    horizontal: 0,
                }),
                &mut scrollbar_state,
            );
        }
    }

    /// Build the content lines for the security overlay
    fn build_content(state: &AppState) -> Vec<Line<'static>> {
        let mut lines = Vec::new();

        lines.push(Self::title_line("Security Monitor"));
        lines.push(Line::from(""));

        let scan_result = match &state.security_scan {
            Some(result) => result,
            None => {
                lines.push(Line::from(Span::styled(
                    "  No scan performed yet. Press R to scan.",
                    Style::default().fg(Color::DarkGray),
                )));
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "  Scans Claude Code config files for security risks:",
                    Style::default().fg(Color::DarkGray),
                )));
                lines.push(Line::from(Span::styled(
                    "    - settings.json (user & project)",
                    Style::default().fg(Color::DarkGray),
                )));
                lines.push(Line::from(Span::styled(
                    "    - mcp.json (user & project)",
                    Style::default().fg(Color::DarkGray),
                )));
                lines.push(Line::from(Span::styled(
                    "    - Hook scripts",
                    Style::default().fg(Color::DarkGray),
                )));
                return lines;
            }
        };

        // Summary bar
        Self::build_summary(&mut lines, scan_result);
        lines.push(Line::from(""));

        // Scan info
        lines.push(Line::from(vec![
            Span::styled("  Scanned: ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!(
                    "{} files, {} projects",
                    scan_result.files_scanned,
                    scan_result.scanned_projects.len()
                ),
                Style::default().fg(Color::White),
            ),
            Span::styled("  at ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                scan_result.scanned_at.format("%H:%M:%S").to_string(),
                Style::default().fg(Color::White),
            ),
        ]));
        lines.push(Line::from(""));

        if scan_result.is_clean() {
            lines.push(Line::from(Span::styled(
                "  No security risks detected.",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "  Press S or Esc to close",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        // Risk list
        Self::build_risk_list(&mut lines, scan_result);

        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  Press R to rescan, S or Esc to close",
            Style::default().fg(Color::DarkGray),
        )));

        lines
    }

    /// Build summary counts by severity
    fn build_summary(lines: &mut Vec<Line<'static>>, result: &ScanResult) {
        let critical = result.count_by_severity(Severity::Critical);
        let high = result.count_by_severity(Severity::High);
        let medium = result.count_by_severity(Severity::Medium);
        let low = result.count_by_severity(Severity::Low);

        let mut spans = vec![Span::styled("  ", Style::default())];

        if critical > 0 {
            spans.push(Span::styled(
                format!(" {} CRITICAL ", critical),
                Style::default()
                    .fg(Color::White)
                    .bg(Color::Red)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled("  ", Style::default()));
        }
        if high > 0 {
            spans.push(Span::styled(
                format!(" {} HIGH ", high),
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Rgb(255, 165, 0))
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled("  ", Style::default()));
        }
        if medium > 0 {
            spans.push(Span::styled(
                format!(" {} MEDIUM ", medium),
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled("  ", Style::default()));
        }
        if low > 0 {
            spans.push(Span::styled(
                format!(" {} LOW ", low),
                Style::default()
                    .fg(Color::White)
                    .bg(Color::Blue)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled("  ", Style::default()));
        }

        if result.is_clean() {
            spans.push(Span::styled(
                " ALL CLEAR ",
                Style::default()
                    .fg(Color::White)
                    .bg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ));
        }

        lines.push(Line::from(spans));
    }

    /// Build the individual risk entries
    fn build_risk_list(lines: &mut Vec<Line<'static>>, result: &ScanResult) {
        lines.push(Self::section_header("Findings"));
        lines.push(Line::from(""));

        for risk in &result.risks {
            let severity_color = Self::severity_color(risk.severity);

            // Header line: severity badge + rule ID + summary
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    format!(" {} ", risk.severity),
                    Style::default()
                        .fg(
                            if risk.severity == Severity::Critical || risk.severity == Severity::Low
                            {
                                Color::White
                            } else {
                                Color::Black
                            },
                        )
                        .bg(severity_color)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(" [{}] ", risk.rule_id),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    risk.summary.clone(),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));

            // Category + source
            lines.push(Line::from(vec![
                Span::styled("    ", Style::default()),
                Span::styled(
                    format!("{}", risk.category),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(" | ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{}", risk.source),
                    Style::default().fg(Color::DarkGray),
                ),
            ]));

            // Detail (wrapped manually for readability)
            let detail_prefix = "    ";
            for detail_line in risk.detail.lines() {
                lines.push(Line::from(Span::styled(
                    format!("{}{}", detail_prefix, detail_line),
                    Style::default().fg(Color::White),
                )));
            }

            // Matched value if present
            if let Some(ref matched) = risk.matched_value {
                lines.push(Line::from(vec![
                    Span::styled("    Matched: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(matched.clone(), Style::default().fg(severity_color)),
                ]));
            }

            lines.push(Line::from(""));
        }
    }

    /// Get color for a severity level
    fn severity_color(severity: Severity) -> Color {
        match severity {
            Severity::Critical => Color::Red,
            Severity::High => Color::Rgb(255, 165, 0),
            Severity::Medium => Color::Yellow,
            Severity::Low => Color::Blue,
        }
    }

    /// Create a title line
    fn title_line(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            text.to_string(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )])
    }

    /// Create a section header line
    fn section_header(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            format!("\u{2500}\u{2500}\u{2500} {} \u{2500}\u{2500}\u{2500}", text),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_content_no_scan() {
        let state = AppState::new();
        let lines = SecurityOverlay::build_content(&state);
        // Should have title + empty state message
        assert!(lines.len() >= 2);
    }

    #[test]
    fn test_build_content_clean_scan() {
        let mut state = AppState::new();
        state.security_scan = Some(tmai_core::security::ScanResult {
            risks: vec![],
            scanned_at: chrono::Utc::now(),
            scanned_projects: vec![],
            files_scanned: 2,
        });
        let lines = SecurityOverlay::build_content(&state);
        let text: String = lines
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.to_string()))
            .collect();
        assert!(text.contains("No security risks detected"));
    }

    #[test]
    fn test_build_content_with_risks() {
        let mut state = AppState::new();
        state.security_scan = Some(tmai_core::security::ScanResult {
            risks: vec![tmai_core::security::SecurityRisk {
                rule_id: "PERM-001".to_string(),
                severity: Severity::Critical,
                category: tmai_core::security::SecurityCategory::Permissions,
                summary: "Test finding".to_string(),
                detail: "Test detail".to_string(),
                source: tmai_core::security::SettingsSource::UserGlobal,
                matched_value: Some("value".to_string()),
            }],
            scanned_at: chrono::Utc::now(),
            scanned_projects: vec![],
            files_scanned: 1,
        });
        let lines = SecurityOverlay::build_content(&state);
        let text: String = lines
            .iter()
            .flat_map(|l| l.spans.iter().map(|s| s.content.to_string()))
            .collect();
        assert!(text.contains("PERM-001"));
        assert!(text.contains("Test finding"));
    }

    #[test]
    fn test_severity_color() {
        assert_eq!(
            SecurityOverlay::severity_color(Severity::Critical),
            Color::Red
        );
        assert_eq!(
            SecurityOverlay::severity_color(Severity::High),
            Color::Rgb(255, 165, 0)
        );
        assert_eq!(
            SecurityOverlay::severity_color(Severity::Medium),
            Color::Yellow
        );
        assert_eq!(SecurityOverlay::severity_color(Severity::Low), Color::Blue);
    }
}
