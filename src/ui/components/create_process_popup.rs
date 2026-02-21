use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame,
};

use tmai_core::agents::AgentType;
use tmai_core::state::{AppState, CreateProcessStep, DirItem, TreeEntry};

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
            CreateProcessStep::SelectTarget => "Select target:",
            CreateProcessStep::SelectDirectory => {
                if create_state.is_input_mode {
                    "Enter directory path:"
                } else {
                    "Select directory:"
                }
            }
            CreateProcessStep::SelectAgent => "Select AI agent:",
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

    /// Render content for selecting target from tree
    fn render_select_target(
        create_state: &tmai_core::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "Create New Process";

        let items: Vec<ListItem> = create_state
            .tree_entries
            .iter()
            .map(|entry| match entry {
                TreeEntry::NewSession => ListItem::new(Line::from(vec![
                    Span::styled("[+] ", Style::default().fg(Color::Green)),
                    Span::styled("New Session", Style::default().fg(Color::Green)),
                ])),
                TreeEntry::Session { name, collapsed } => {
                    let arrow = if *collapsed { "▸" } else { "▾" };
                    ListItem::new(Line::from(vec![
                        Span::styled(format!("{} ", arrow), Style::default().fg(Color::Blue)),
                        Span::styled(
                            name.clone(),
                            Style::default()
                                .fg(Color::Blue)
                                .add_modifier(Modifier::BOLD),
                        ),
                    ]))
                }
                TreeEntry::NewWindow { .. } => ListItem::new(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled("[+] ", Style::default().fg(Color::Cyan)),
                    Span::styled("New Window", Style::default().fg(Color::Cyan)),
                ])),
                TreeEntry::Window {
                    index,
                    name,
                    collapsed,
                    ..
                } => {
                    let arrow = if *collapsed { "▸" } else { "▾" };
                    let display_name = if name.is_empty() || name == "bash" || name == "zsh" {
                        format!("window-{}", index)
                    } else {
                        format!("{} ({})", name, index)
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("  ", Style::default()),
                        Span::styled(format!("{} ", arrow), Style::default().fg(Color::Yellow)),
                        Span::styled(display_name, Style::default().fg(Color::Yellow)),
                    ]))
                }
                TreeEntry::SplitPane { target } => ListItem::new(Line::from(vec![
                    Span::styled("    ", Style::default()),
                    Span::styled("[+] ", Style::default().fg(Color::White)),
                    Span::styled(
                        format!("Split {}", target),
                        Style::default().fg(Color::White),
                    ),
                ])),
            })
            .collect();

        let help = "↑/↓: Select  Enter: Confirm/Toggle  Esc: Cancel";

        (title, items, help)
    }

    /// Render content for selecting directory
    fn render_select_directory(
        create_state: &tmai_core::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "Create New Process";

        let items: Vec<ListItem> = create_state
            .directory_items
            .iter()
            .map(|item| match item {
                DirItem::Header(label) => ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("── {} ", label),
                        Style::default().fg(Color::DarkGray),
                    ),
                    Span::styled("─".repeat(20), Style::default().fg(Color::DarkGray)),
                ])),
                DirItem::EnterPath => ListItem::new(Line::from(vec![Span::styled(
                    "Enter path...",
                    Style::default().fg(Color::Yellow),
                )])),
                DirItem::Home => ListItem::new(Line::from(vec![Span::styled(
                    "~ (Home directory)",
                    Style::default().fg(Color::White),
                )])),
                DirItem::Current => ListItem::new(Line::from(vec![Span::styled(
                    ". (Current directory)",
                    Style::default().fg(Color::White),
                )])),
                DirItem::Directory { display, .. } => {
                    ListItem::new(Line::from(vec![Span::styled(
                        format!("  {}", display),
                        Style::default().fg(Color::Cyan),
                    )]))
                }
            })
            .collect();

        let help = if create_state.is_input_mode {
            "Enter: Confirm  Esc: Back"
        } else {
            "↑/↓: Select  Enter: Confirm  Esc: Back"
        };

        (title, items, help)
    }

    /// Render content for selecting agent type
    fn render_select_agent(
        _create_state: &tmai_core::state::CreateProcessState,
    ) -> (&'static str, Vec<ListItem<'static>>, &'static str) {
        let title = "Create New Process";

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

        let help = "↑/↓: Select  Enter: Launch  Esc: Back";

        (title, items, help)
    }

    /// Get the number of items in the current step
    pub fn item_count(state: &AppState) -> usize {
        let Some(create_state) = &state.create_process else {
            return 0;
        };

        match create_state.step {
            CreateProcessStep::SelectTarget => create_state.tree_entries.len(),
            CreateProcessStep::SelectDirectory => create_state.directory_items.len(),
            CreateProcessStep::SelectAgent => AgentType::all_variants().len(),
        }
    }
}
