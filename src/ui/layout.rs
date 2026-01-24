use ratatui::layout::{Constraint, Direction, Rect};

/// Layout configuration for the UI
pub struct Layout {
    /// Height percentage for the preview panel
    pub preview_height_pct: u16,
    /// Whether to show the preview panel
    pub show_preview: bool,
}

impl Layout {
    /// Create a new layout with default settings
    pub fn new() -> Self {
        Self {
            preview_height_pct: 40,
            show_preview: true,
        }
    }

    /// Create a layout with custom preview height
    pub fn with_preview_height(mut self, height_pct: u16) -> Self {
        self.preview_height_pct = height_pct.min(80).max(20);
        self
    }

    /// Toggle preview panel visibility
    pub fn toggle_preview(&mut self) {
        self.show_preview = !self.show_preview;
    }

    /// Calculate the main areas
    pub fn calculate(&self, area: Rect) -> LayoutAreas {
        if self.show_preview {
            // Split vertically: session list (top), preview (bottom)
            let list_height = 100 - self.preview_height_pct;
            let chunks = ratatui::layout::Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Percentage(list_height),
                    Constraint::Percentage(self.preview_height_pct),
                    Constraint::Length(1), // Status bar
                ])
                .split(area);

            LayoutAreas {
                session_list: chunks[0],
                preview: Some(chunks[1]),
                status_bar: chunks[2],
            }
        } else {
            // No preview: session list takes most space
            let chunks = ratatui::layout::Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Min(3),    // Session list
                    Constraint::Length(1), // Status bar
                ])
                .split(area);

            LayoutAreas {
                session_list: chunks[0],
                preview: None,
                status_bar: chunks[1],
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
        assert_eq!(areas.status_bar.height, 1);
    }

    #[test]
    fn test_layout_no_preview() {
        let mut layout = Layout::new();
        layout.show_preview = false;
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.preview.is_none());
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
