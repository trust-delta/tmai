use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
    },
    Frame,
};

use tmai_core::state::AppState;

/// Full-screen help widget
pub struct HelpScreen;

impl HelpScreen {
    /// Render the help screen (full screen)
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let help_lines = Self::build_help_content(state);
        let total_lines = help_lines.len();

        // Calculate visible area (subtract 2 for border)
        let visible_height = area.height.saturating_sub(2) as usize;

        // Clamp scroll to valid range
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = (state.view.help_scroll as usize).min(max_scroll);

        let block = Block::default()
            .title(" Help (j/k or ↑/↓ to scroll, q to close) ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        let paragraph = Paragraph::new(help_lines)
            .block(block)
            .scroll((scroll as u16, 0));

        frame.render_widget(paragraph, area);

        // Render scrollbar
        if total_lines > visible_height {
            let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("↑"))
                .end_symbol(Some("↓"));

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

    fn build_help_content(state: &AppState) -> Vec<Line<'static>> {
        // Monitor scope is currently fixed to AllSessions (s/m keys disabled)
        let scope_str = "All Sessions".to_string();

        vec![
            Self::title_line("tmai - Tmux Multi Agent Interface"),
            Line::from(""),
            Self::section_header("Current Settings"),
            Line::from(vec![
                Span::styled("  Monitor Scope: ", Style::default().fg(Color::DarkGray)),
                Span::styled(scope_str, Style::default().fg(Color::Magenta)),
            ]),
            Line::from(vec![
                Span::styled("  Sort Method:   ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    state.sort_by.display_name().to_string(),
                    Style::default().fg(Color::Blue),
                ),
            ]),
            Line::from(vec![
                Span::styled("  Agents:        ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    format!("{} monitored", state.agents.len()),
                    Style::default().fg(Color::Green),
                ),
            ]),
            Line::from(""),
            Self::section_header("Navigation"),
            Self::key_line("j / ↓", "Select next agent in list"),
            Self::key_line("k / ↑", "Select previous agent in list"),
            Self::key_line("g", "Jump to first agent"),
            Self::key_line("G", "Jump to last agent"),
            Self::key_line("Ctrl+d", "Scroll preview pane down (half page)"),
            Self::key_line("Ctrl+u", "Scroll preview pane up (half page)"),
            Line::from(""),
            Self::section_header("Agent Actions"),
            Self::key_line("f", "Focus the selected pane in tmux"),
            Self::description_line("  Switches tmux to show the selected agent's pane"),
            Self::key_line("x", "Kill the selected pane (with confirmation)"),
            Self::description_line("  Terminates the agent process and closes the pane"),
            Self::key_line("W", "Restart as IPC-wrapped (non-IPC Claude Code only)"),
            Self::description_line(
                "  Resumes the session with PTY wrapping for high-precision detection",
            ),
            Self::key_line("U", "Fetch subscription usage from Claude Code"),
            Self::description_line(
                "  Spawns a temporary Claude Code to run /usage, displays below agent list",
            ),
            Line::from(""),
            Self::section_header("Approval"),
            Self::key_line("y", "Approve / select Yes"),
            Self::key_line("n", "Select No (UserQuestion only)"),
            Self::description_line("  For other options, use number keys or input mode"),
            Line::from(""),
            Self::section_header("AskUserQuestion (Selection Dialogs)"),
            Self::key_line("1-9", "Select option by number"),
            Self::description_line("  All keys support full-width input (IME on)"),
            Self::description_line("  Single-select: immediately confirms the choice"),
            Self::description_line("  Multi-select: toggles the option on/off"),
            Self::key_line("Space", "Toggle current option (multi-select mode)"),
            Self::key_line("Enter", "Confirm selection (multi-select mode)"),
            Self::description_line("  On 'Type something': opens input mode"),
            Line::from(""),
            Self::section_header("Input Mode"),
            Self::key_line("i", "Enter input mode to type text"),
            Self::key_line("/", "Enter input mode (alternative)"),
            Self::description_line("  While in input mode:"),
            Self::key_line("  Enter", "Send the typed text to agent"),
            Self::key_line("  Esc", "Cancel and exit input mode"),
            Self::key_line("  ← / →", "Move cursor left/right"),
            Self::key_line("  Home/End", "Jump to start/end of input"),
            Self::key_line("  Backspace", "Delete character before cursor"),
            Line::from(""),
            Self::section_header("Passthrough Mode"),
            Self::key_line("p", "Enter passthrough mode"),
            Self::key_line("→", "Enter passthrough mode (alternative)"),
            Self::description_line("  All keystrokes are sent directly to the agent's pane."),
            Self::description_line("  Useful for complex interactions not covered by shortcuts."),
            Self::key_line("  Esc", "Exit passthrough mode"),
            Line::from(""),
            Self::section_header("View Options"),
            Self::key_line("Tab", "Cycle view mode"),
            Self::description_line("  Split → List only → Preview only"),
            Self::key_line("l", "Toggle split direction (layout)"),
            Self::description_line("  Horizontal (left/right) ↔ Vertical (top/bottom)"),
            Self::key_line("s", "Cycle sort method (Team → Repository → Directory)"),
            Self::disabled_key_line("m", "Cycle monitor scope (temporarily disabled)"),
            Line::from(""),
            Self::section_header("Agent Teams"),
            Self::key_line("t", "Show task overlay for selected team member"),
            Self::key_line("T", "Show team overview (all teams and members)"),
            Line::from(""),
            Self::section_header("Creating New Agents"),
            Self::key_line("Enter", "On [+] entry: start create process wizard"),
            Self::description_line("  1. Choose placement: New Session / New Window / Split Pane"),
            Self::description_line("  2. Select target session (if applicable)"),
            Self::description_line("  3. Choose working directory"),
            Self::description_line("  4. Select agent type (Claude Code, Codex, Gemini, etc.)"),
            Line::from(""),
            Self::section_header("General"),
            Self::key_line("h / ?", "Toggle this help screen"),
            Self::key_line("q / Esc", "Quit tmai (or close help if open)"),
            Line::from(""),
            Self::section_header("Supported Agents"),
            Self::description_line("  Claude Code - Anthropic's AI coding assistant"),
            Self::description_line("  OpenCode    - Open source AI coding assistant"),
            Self::description_line("  Codex CLI   - OpenAI's command-line tool"),
            Self::description_line("  Gemini CLI  - Google's AI assistant"),
            Line::from(""),
            Self::section_header("Agent Status Indicators"),
            Self::status_line("✓ Idle", "Agent is waiting for input", Color::Green),
            Self::status_line("⠋ Processing", "Agent is working on a task", Color::Yellow),
            Self::status_line(
                "? Approval",
                "Agent needs yes/no confirmation",
                Color::Magenta,
            ),
            Self::status_line("⚠ Error", "Agent encountered an error", Color::Red),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Press q or Esc to close this help screen",
                Style::default().fg(Color::DarkGray),
            )]),
        ]
    }

    fn title_line(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            text.to_string(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )])
    }

    fn section_header(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            format!("─── {} ───", text),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )])
    }

    fn key_line(key: &str, description: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                format!("  {:14}", key),
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(description.to_string(), Style::default().fg(Color::White)),
        ])
    }

    fn disabled_key_line(key: &str, description: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                format!("  {:14}", key),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                description.to_string(),
                Style::default().fg(Color::DarkGray),
            ),
        ])
    }

    fn description_line(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            text.to_string(),
            Style::default().fg(Color::DarkGray),
        )])
    }

    fn status_line(status: &str, description: &str, color: Color) -> Line<'static> {
        Line::from(vec![
            Span::styled(format!("  {:14}", status), Style::default().fg(color)),
            Span::styled(description.to_string(), Style::default().fg(Color::White)),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_line() {
        let line = HelpScreen::key_line("test", "description");
        assert_eq!(line.spans.len(), 2);
    }
}
