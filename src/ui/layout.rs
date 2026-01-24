use ratatui::layout::{Constraint, Direction, Rect};

/// Default height for input area
const INPUT_HEIGHT: u16 = 3;

/// Layout configuration for the UI
pub struct Layout {
    /// Width percentage for the session list (left panel)
    pub session_list_width_pct: u16,
    /// Whether to show the preview panel
    pub show_preview: bool,
    /// Height for input area
    pub input_height: u16,
}

impl Layout {
    /// Create a new layout with default settings
    pub fn new() -> Self {
        Self {
            session_list_width_pct: 35,
            show_preview: true,
            input_height: INPUT_HEIGHT,
        }
    }

    /// Create a layout with custom preview height (now used as session list width)
    pub fn with_preview_height(mut self, _height_pct: u16) -> Self {
        // Keep default width for now
        self.session_list_width_pct = 35;
        self
    }

    /// Toggle preview panel visibility
    pub fn toggle_preview(&mut self) {
        self.show_preview = !self.show_preview;
    }

    /// Set input area height
    pub fn set_input_height(&mut self, height: u16) {
        self.input_height = height.max(3);
    }

    /// Calculate the main areas
    /// Layout: [Session List (left)] [Preview + Input (right)]
    ///                               [    Preview    ]
    ///                               [    Input      ]
    ///         [       Status Bar (full width)       ]
    pub fn calculate(&self, area: Rect) -> LayoutAreas {
        // First, split off the status bar at the bottom
        let main_and_status = ratatui::layout::Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Min(5),    // Main content area
                Constraint::Length(1), // Status bar
            ])
            .split(area);

        let main_area = main_and_status[0];
        let status_bar = main_and_status[1];

        if self.show_preview {
            // Split horizontally: session list (left), preview+input (right)
            let horizontal = ratatui::layout::Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(self.session_list_width_pct), // Session list
                    Constraint::Percentage(100 - self.session_list_width_pct), // Preview + Input
                ])
                .split(main_area);

            // Split right panel vertically: preview (top), input (bottom)
            let right_panel = ratatui::layout::Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Min(3),                    // Preview (flexible)
                    Constraint::Length(self.input_height), // Input area
                ])
                .split(horizontal[1]);

            LayoutAreas {
                session_list: horizontal[0],
                preview: Some(right_panel[0]),
                input: right_panel[1],
                status_bar,
            }
        } else {
            // No preview: session list on left, input on right
            let horizontal = ratatui::layout::Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(self.session_list_width_pct),
                    Constraint::Percentage(100 - self.session_list_width_pct),
                ])
                .split(main_area);

            LayoutAreas {
                session_list: horizontal[0],
                preview: None,
                input: horizontal[1],
                status_bar,
            }
        }
    }

    /// Calculate areas for a popup (centered)
    pub fn popup_area(&self, area: Rect, width_pct: u16, height_pct: u16) -> Rect {
        let popup_layout = ratatui::layout::Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage((100 - height_pct) / 2),
                Constraint::Percentage(height_pct),
                Constraint::Percentage((100 - height_pct) / 2),
            ])
            .split(area);

        ratatui::layout::Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage((100 - width_pct) / 2),
                Constraint::Percentage(width_pct),
                Constraint::Percentage((100 - width_pct) / 2),
            ])
            .split(popup_layout[1])[1]
    }
}

impl Default for Layout {
    fn default() -> Self {
        Self::new()
    }
}

/// Calculated layout areas
pub struct LayoutAreas {
    /// Area for the session/agent list
    pub session_list: Rect,
    /// Area for the preview panel (if shown)
    pub preview: Option<Rect>,
    /// Area for the input widget
    pub input: Rect,
    /// Area for the status bar
    pub status_bar: Rect,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layout_calculation() {
        let layout = Layout::new();
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.preview.is_some());
        assert!(areas.session_list.height > 0);
        assert_eq!(areas.input.height, 3);
        assert_eq!(areas.status_bar.height, 1);
    }

    #[test]
    fn test_layout_no_preview() {
        let mut layout = Layout::new();
        layout.show_preview = false;
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.preview.is_none());
        // In horizontal layout without preview, input takes the right panel
        assert!(areas.input.height > 0);
        assert!(areas.input.width > 0);
    }

    #[test]
    fn test_popup_area() {
        let layout = Layout::new();
        let area = Rect::new(0, 0, 100, 50);
        let popup = layout.popup_area(area, 60, 40);

        // Popup should be centered
        assert!(popup.x > 0);
        assert!(popup.y > 0);
        assert!(popup.x + popup.width < area.width);
        assert!(popup.y + popup.height < area.height);
    }
}
