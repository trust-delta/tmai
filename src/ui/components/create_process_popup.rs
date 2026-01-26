use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::agents::AgentType;
use crate::state::{AppState, CreateProcessStep, PlacementType};

/// Popup for creating a new AI process
pub struct CreateProcessPopup;

impl CreateProcessPopup {
    /// Render the create process popup
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let Some(create_state) = &state.create_process else {
            return;
        };

        // Clear the popup area
        frame.render_widget(Clear, area);

        // Build content based on current step
        let (title, items, help_text) = match create_state.step {
            CreateProcessStep::SelectPlacement => Self::render_select_placement(create_state),
            CreateProcessStep::SelectTarget => Self::render_select_target(create_state),
            CreateProcessStep::SelectDirectory => Self::render_select_directory(create_state),
            CreateProcessStep::SelectAgent => Self::render_select_agent(create_state),
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
            CreateProcessStep::SelectPlacement => "作成場所を選択:",
            CreateProcessStep::SelectTarget => "tmuxセッションを選択:",
            CreateProcessStep::SelectDirectory => {
                if create_state.is_input_mode {
                    "ディレクトリパスを入力:"
                } else {
                    "ディレクトリを選択:"
                }
            }
            CreateProcessStep::SelectAgent => "AIエージェントを選択:",
        };
        let header_widget = Paragraph::new(header).style(Style::default().fg(Color::Yellow));
        frame.render_widget(header_widget, inner_chunks[0]);

        // Input mode for directory
        if create_state.step == CreateProcessStep::SelectDirectory && create_state.is_input_mode {
            let input_text = format!("> {}_", &create_state.input_buffer);
            let input_widget = Paragraph::new(input_text).style(Style::default().fg(Color::White));
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

    /// Render content for selecting placement type
    fn render_select_placement(
        _create_state: &crate::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規プロセス作成";

        let items = vec![
            ListItem::new(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled("新規セッション", Style::default().fg(Color::Green)),
                Span::styled(
                    "  (独立したセッションを作成)",
                    Style::default().fg(Color::DarkGray),
                ),
            ])),
            ListItem::new(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled("新規ウィンドウ", Style::default().fg(Color::Cyan)),
                Span::styled(
                    "  (既存セッションにタブ追加)",
                    Style::default().fg(Color::DarkGray),
                ),
            ])),
            ListItem::new(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled("ペイン追加", Style::default().fg(Color::Yellow)),
                Span::styled(
                    "  (既存ウィンドウを分割)",
                    Style::default().fg(Color::DarkGray),
                ),
            ])),
        ];

        let help = "↑/↓: 選択  Enter: 決定  Esc: キャンセル";

        (title, items, help)
    }

    /// Render content for selecting tmux session
    fn render_select_target(
        create_state: &crate::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規プロセス作成";

        let items: Vec<ListItem> = create_state
            .available_sessions
            .iter()
            .map(|s| {
                ListItem::new(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(s.clone(), Style::default().fg(Color::White)),
                ]))
            })
            .collect();

        let help = "↑/↓: 選択  Enter: 決定  Esc: 戻る";

        (title, items, help)
    }

    /// Render content for selecting directory
    fn render_select_directory(
        create_state: &crate::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規プロセス作成";

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
        _create_state: &crate::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "新規プロセス作成";

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
        let Some(create_state) = &state.create_process else {
            return 0;
        };

        match create_state.step {
            CreateProcessStep::SelectPlacement => 3, // NewSession, NewWindow, SplitPane
            CreateProcessStep::SelectTarget => create_state.available_sessions.len(),
            CreateProcessStep::SelectDirectory => 3 + create_state.known_directories.len(), // Input, home, current + known dirs
            CreateProcessStep::SelectAgent => AgentType::all_variants().len(),
        }
    }

    /// Get the placement type from cursor position
    pub fn get_placement_type(cursor: usize) -> Option<PlacementType> {
        match cursor {
            0 => Some(PlacementType::NewSession),
            1 => Some(PlacementType::NewWindow),
            2 => Some(PlacementType::SplitPane),
            _ => None,
        }
    }
}
