use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::agents::AgentType;
use crate::state::{AppState, CreateSessionStep};

/// Popup for creating a new AI session
pub struct CreateSessionPopup;

impl CreateSessionPopup {
    /// Render the create session popup
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let Some(create_state) = &state.create_session else {
            return;
        };

        // Clear the popup area
        frame.render_widget(Clear, area);

        // Build content based on current step
        let (title, items, help_text) = match create_state.step {
            CreateSessionStep::SelectTarget => Self::render_select_target(create_state),
            CreateSessionStep::SelectDirectory => Self::render_select_directory(create_state),
            CreateSessionStep::SelectAgent => Self::render_select_agent(create_state),
        };

        // Layout: title, list, help
        let _chunks = Layout::vertical([
            Constraint::Length(3), // Title
            Constraint::Min(5),    // List
            Constraint::Length(2), // Help
        ])
        .split(area);

        // Title block
        let title_block = Block::default()
            .title(format!(" {} ", title))
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        frame.render_widget(title_block, area);

        // Adjust inner area
        let inner = Rect {
            x: area.x + 1,
            y: area.y + 1,
            width: area.width.saturating_sub(2),
            height: area.height.saturating_sub(2),
        };

        let inner_chunks = Layout::vertical([
            Constraint::Length(1), // Header
            Constraint::Min(3),    // List
            Constraint::Length(1), // Help
        ])
        .split(inner);

        // Header text
        let header = match create_state.step {
            CreateSessionStep::SelectTarget => "tmuxセッションを選択:",
            CreateSessionStep::SelectDirectory => {
                if create_state.is_input_mode {
                    "ディレクトリパスを入力:"
                } else {
                    "ディレクトリを選択:"
                }
            }
            CreateSessionStep::SelectAgent => "AIエージェントを選択:",
        };
        let header_widget = Paragraph::new(header)
            .style(Style::default().fg(Color::Yellow));
        frame.render_widget(header_widget, inner_chunks[0]);

        // Input mode for directory
        if create_state.step == CreateSessionStep::SelectDirectory && create_state.is_input_mode {
            let input_text = format!("> {}_", &create_state.input_buffer);
            let input_widget = Paragraph::new(input_text)
                .style(Style::default().fg(Color::White));
            frame.render_widget(input_widget, inner_chunks[1]);
        } else {
            // List
            let list = List::new(items)
                .highlight_style(
                    Style::default()
                        .bg(Color::DarkGray)
                        .add_modifier(Modifier::BOLD),
                )
                .highlight_symbol("> ");

            let mut list_state = ListState::default();
            list_state.select(Some(create_state.cursor));

            frame.render_stateful_widget(list, inner_chunks[1], &mut list_state);
        }

        // Help text
        let help_widget = Paragraph::new(help_text)
            .style(Style::default().fg(Color::DarkGray))
            .alignment(Alignment::Center);
        frame.render_widget(help_widget, inner_chunks[2]);
    }

    /// Render content for selecting tmux session
    fn render_select_target(
        create_state: &crate::state::CreateSessionState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規セッション作成";

        let mut items: Vec<ListItem> = create_state
            .available_sessions
            .iter()
            .map(|s| {
                ListItem::new(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(s.clone(), Style::default().fg(Color::White)),
                ]))
            })
            .collect();

        // Add "new session" option
        items.push(ListItem::new(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                "+ 新しいセッション",
                Style::default().fg(Color::Green),
            ),
        ])));

        let help = "↑/↓: 選択  Enter: 決定  Esc: キャンセル";

        (title, items, help)
    }

    /// Render content for selecting directory
    fn render_select_directory(
        create_state: &crate::state::CreateSessionState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規セッション作成";

        let mut items = vec![
            ListItem::new(Line::from(vec![Span::styled(
                "パスを入力...",
                Style::default().fg(Color::Yellow),
            )])),
            ListItem::new(Line::from(vec![Span::styled(
                "~ (ホームディレクトリ)",
                Style::default().fg(Color::White),
            )])),
            ListItem::new(Line::from(vec![Span::styled(
                ". (現在のディレクトリ)",
                Style::default().fg(Color::White),
            )])),
        ];

        // Add known directories from current agents
        for dir in &create_state.known_directories {
            let display = if dir.len() > 40 {
                format!("...{}", &dir[dir.len() - 37..])
            } else {
                dir.clone()
            };
            items.push(ListItem::new(Line::from(vec![Span::styled(
                display,
                Style::default().fg(Color::Cyan),
            )])));
        }

        let help = if create_state.is_input_mode {
            "Enter: 決定  Esc: 戻る"
        } else {
            "↑/↓: 選択  Enter: 決定  Esc: 戻る"
        };

        (title, items, help)
    }

    /// Render content for selecting agent type
    fn render_select_agent(
        _create_state: &crate::state::CreateSessionState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規セッション作成";

        let items: Vec<ListItem> = AgentType::all_variants()
            .into_iter()
            .map(|agent_type| {
                ListItem::new(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(
                        agent_type.short_name().to_string(),
                        Style::default().fg(Color::Cyan),
                    ),
                    Span::styled(" - ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        agent_type.command().to_string(),
                        Style::default().fg(Color::White),
                    ),
                ]))
            })
            .collect();

        let help = "↑/↓: 選択  Enter: 起動  Esc: 戻る";

        (title, items, help)
    }

    /// Get the number of items in the current step
    pub fn item_count(state: &AppState) -> usize {
        let Some(create_state) = &state.create_session else {
            return 0;
        };

        match create_state.step {
            CreateSessionStep::SelectTarget => create_state.available_sessions.len() + 1, // +1 for "new session"
            CreateSessionStep::SelectDirectory => 3 + create_state.known_directories.len(), // Input, home, current + known dirs
            CreateSessionStep::SelectAgent => AgentType::all_variants().len(),
        }
    }
}
