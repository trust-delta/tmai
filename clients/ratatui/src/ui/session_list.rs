//! Single-screen agent list renderer.
//!
//! The legacy bundled TUI's `session_list.rs` was 1397 lines with a full
//! multi-pane layout, team overview, status bar, usage bar, previews,
//! confirmation popups and more. This milestone ports only the bare
//! minimum: a scrollable agent list with phase/status indicators and a
//! footer showing current key bindings.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::types::{AgentSnapshot, Phase};

pub struct SessionListView<'a> {
    pub agents: &'a [AgentSnapshot],
    pub selected: usize,
    pub input_mode: InputModeView<'a>,
    pub status_line: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub enum InputModeView<'a> {
    Normal,
    Text { buffer: &'a str },
    Confirm { prompt: &'a str },
}

pub fn render(frame: &mut Frame, area: Rect, view: SessionListView<'_>) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1), // header
            Constraint::Min(1),    // list
            Constraint::Length(3), // input / hint box
            Constraint::Length(1), // status
        ])
        .split(area);

    render_header(frame, chunks[0], view.agents.len());
    render_list(frame, chunks[1], view.agents, view.selected);
    render_input(frame, chunks[2], view.input_mode);
    render_status(frame, chunks[3], view.status_line);
}

fn render_header(frame: &mut Frame, area: Rect, count: usize) {
    let title = format!(" tmai-ratatui — {} agent(s) ", count);
    let para = Paragraph::new(title).style(Style::default().add_modifier(Modifier::BOLD));
    frame.render_widget(para, area);
}

fn render_list(frame: &mut Frame, area: Rect, agents: &[AgentSnapshot], selected: usize) {
    let items: Vec<ListItem> = agents
        .iter()
        .map(|agent| {
            let phase_style = phase_color(agent);
            let phase_tag = format!("[{:^8}]", phase_label(agent));
            let virtual_marker = if agent.is_virtual { "·" } else { " " };
            let orch_marker = if agent.is_orchestrator { "★" } else { " " };
            let content = Line::from(vec![
                Span::styled(phase_tag, phase_style),
                Span::raw(" "),
                Span::raw(orch_marker.to_string()),
                Span::raw(virtual_marker.to_string()),
                Span::raw(" "),
                Span::raw(agent.display_label.clone()),
                Span::raw("  "),
                Span::styled(agent.target.clone(), Style::default().fg(Color::DarkGray)),
            ]);
            ListItem::new(content)
        })
        .collect();

    let block = Block::default().borders(Borders::ALL).title(" agents ");
    let list = List::new(items)
        .block(block)
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    let mut state = ListState::default();
    if !agents.is_empty() {
        state.select(Some(selected.min(agents.len().saturating_sub(1))));
    }

    frame.render_stateful_widget(list, area, &mut state);
}

fn render_input(frame: &mut Frame, area: Rect, mode: InputModeView<'_>) {
    let (title, body, style) = match mode {
        InputModeView::Normal => (
            " keys ",
            Line::from(vec![
                key("j/k"),
                sep(" nav  "),
                key("i"),
                sep(" input  "),
                key("a"),
                sep(" approve  "),
                key("y/n"),
                sep(" yes/no  "),
                key("K"),
                sep(" kill  "),
                key("r"),
                sep(" refresh  "),
                key("q"),
                sep(" quit"),
            ]),
            Style::default(),
        ),
        InputModeView::Text { buffer } => (
            " send text (Enter to send, Esc to cancel) ",
            Line::from(buffer.to_string()),
            Style::default().fg(Color::Yellow),
        ),
        InputModeView::Confirm { prompt } => (
            " confirm (y/n) ",
            Line::from(prompt.to_string()),
            Style::default().fg(Color::Red),
        ),
    };

    let block = Block::default().borders(Borders::ALL).title(title);
    let para = Paragraph::new(body).block(block).style(style);
    frame.render_widget(para, area);
}

fn render_status(frame: &mut Frame, area: Rect, text: &str) {
    let para = Paragraph::new(text.to_string()).style(Style::default().fg(Color::DarkGray));
    frame.render_widget(para, area);
}

/// Phase tag label read directly from the core-provided `phase` field.
fn phase_label(agent: &AgentSnapshot) -> &'static str {
    match &agent.phase {
        Some(Phase::Working) => "working",
        Some(Phase::Blocked) => "blocked",
        Some(Phase::Idle) => "idle",
        Some(Phase::Offline) => "offline",
        None => "?",
    }
}

/// UI color for the phase tag, reading from the core-provided `phase` field.
fn phase_color(agent: &AgentSnapshot) -> Style {
    let base = Style::default();
    match &agent.phase {
        Some(Phase::Working) => base.fg(Color::Cyan),
        Some(Phase::Blocked) => base.fg(Color::Yellow),
        Some(Phase::Idle) => base.fg(Color::Green),
        Some(Phase::Offline) => base.fg(Color::DarkGray),
        None => base,
    }
}

fn key(k: &'static str) -> Span<'static> {
    Span::styled(
        k,
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )
}

fn sep(s: &'static str) -> Span<'static> {
    Span::raw(s)
}
