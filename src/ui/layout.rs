use ratatui::layout::{Constraint, Direction, Rect};

/// Default height for input area
const INPUT_HEIGHT: u16 = 3;

/// Split direction for panel layout
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SplitDirection {
    #[default]
    Horizontal, // 左右分割（agents | preview）
    Vertical, // 上下分割（agents / preview）
}

impl SplitDirection {
    /// Toggle between horizontal and vertical
    pub fn toggle(self) -> Self {
        match self {
            Self::Horizontal => Self::Vertical,
            Self::Vertical => Self::Horizontal,
        }
    }

    /// Get short display name for status bar
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Horizontal => "H",
            Self::Vertical => "V",
        }
    }
}

/// View mode for panel layout
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ViewMode {
    /// Show both agents list and preview (split view)
    #[default]
    Both,
    /// Show only agents list (full width)
    AgentsOnly,
    /// Show only preview (full width)
    PreviewOnly,
}

impl ViewMode {
    /// Get display name
    pub fn display_name(&self) -> &'static str {
        match self {
            ViewMode::Both => "Split",
            ViewMode::AgentsOnly => "List",
            ViewMode::PreviewOnly => "Preview",
        }
    }
}

/// Step size for split offset adjustment
const SPLIT_STEP: u16 = 10;

/// Layout configuration for the UI
pub struct Layout {
    /// Split offset: 0=list only, 100=preview only, 10-90=split view
    /// Direction-agnostic — applies as width% in horizontal, height% in vertical.
    pub split_offset: u16,
    /// Current split direction
    pub split_direction: SplitDirection,
    /// Height for input area
    pub input_height: u16,
}

impl Layout {
    /// Create a new layout with default settings
    pub fn new() -> Self {
        Self {
            split_offset: 60,
            split_direction: SplitDirection::default(),
            input_height: INPUT_HEIGHT,
        }
    }

    /// Create a layout with custom split offset
    pub fn with_split_offset(mut self, offset: u16) -> Self {
        self.split_offset = offset.clamp(0, 100);
        self
    }

    /// Step split offset by -10 (shrinks preview, expands list).
    /// Wraps: ...10 → 0 → 100 → 90...
    /// Returns the new split_offset for config saving.
    pub fn step_split_offset_down(&mut self) -> u16 {
        self.split_offset = if self.split_offset == 0 {
            100
        } else {
            self.split_offset.saturating_sub(SPLIT_STEP)
        };
        self.split_offset
    }

    /// Step split offset by +10 (expands preview, shrinks list).
    /// Wraps: ...90 → 100 → 0 → 10...
    /// Returns the new split_offset for config saving.
    pub fn step_split_offset_up(&mut self) -> u16 {
        self.split_offset = if self.split_offset >= 100 {
            0
        } else {
            (self.split_offset + SPLIT_STEP).min(100)
        };
        self.split_offset
    }

    /// Derive ViewMode from split_offset
    pub fn view_mode(&self) -> ViewMode {
        match self.split_offset {
            0 => ViewMode::AgentsOnly,
            100 => ViewMode::PreviewOnly,
            _ => ViewMode::Both,
        }
    }

    /// Toggle split direction (Horizontal <-> Vertical)
    pub fn toggle_split_direction(&mut self) {
        self.split_direction = self.split_direction.toggle();
    }

    /// Get current split direction
    pub fn split_direction(&self) -> SplitDirection {
        self.split_direction
    }

    /// Get the list panel percentage (inverse of split_offset)
    fn list_pct(&self) -> u16 {
        100 - self.split_offset
    }

    /// Set input area height
    pub fn set_input_height(&mut self, height: u16) {
        self.input_height = height.max(3);
    }

    /// Calculate the main areas
    /// Layout: [Session List (left)] [Preview (right)]
    ///         [       Status Bar (full width)       ]
    /// When show_input is true, input area appears at bottom of preview
    pub fn calculate(&self, area: Rect) -> LayoutAreas {
        self.calculate_with_input(area, false)
    }

    /// Calculate layout with optional input area
    pub fn calculate_with_input(&self, area: Rect, show_input: bool) -> LayoutAreas {
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

        match self.view_mode() {
            ViewMode::Both => match self.split_direction {
                SplitDirection::Horizontal => {
                    // Split horizontally: session list (left), preview+input (right)
                    let horizontal = ratatui::layout::Layout::default()
                        .direction(Direction::Horizontal)
                        .constraints([
                            Constraint::Percentage(self.list_pct()),
                            Constraint::Percentage(self.split_offset),
                        ])
                        .split(main_area);

                    if show_input {
                        // Split right panel vertically: preview (top), input (bottom)
                        let right_panel = ratatui::layout::Layout::default()
                            .direction(Direction::Vertical)
                            .constraints([
                                Constraint::Min(3),
                                Constraint::Length(self.input_height),
                            ])
                            .split(horizontal[1]);

                        LayoutAreas {
                            session_list: Some(horizontal[0]),
                            preview: Some(right_panel[0]),
                            input: Some(right_panel[1]),
                            status_bar,
                            split_direction: self.split_direction,
                        }
                    } else {
                        LayoutAreas {
                            session_list: Some(horizontal[0]),
                            preview: Some(horizontal[1]),
                            input: None,
                            status_bar,
                            split_direction: self.split_direction,
                        }
                    }
                }
                SplitDirection::Vertical => {
                    // Split vertically: session list (top), preview+input (bottom)
                    let vertical = ratatui::layout::Layout::default()
                        .direction(Direction::Vertical)
                        .constraints([
                            Constraint::Percentage(self.list_pct()),
                            Constraint::Percentage(self.split_offset),
                        ])
                        .split(main_area);

                    if show_input {
                        // Split bottom panel vertically: preview (top), input (bottom)
                        let bottom_panel = ratatui::layout::Layout::default()
                            .direction(Direction::Vertical)
                            .constraints([
                                Constraint::Min(3),
                                Constraint::Length(self.input_height),
                            ])
                            .split(vertical[1]);

                        LayoutAreas {
                            session_list: Some(vertical[0]),
                            preview: Some(bottom_panel[0]),
                            input: Some(bottom_panel[1]),
                            status_bar,
                            split_direction: self.split_direction,
                        }
                    } else {
                        LayoutAreas {
                            session_list: Some(vertical[0]),
                            preview: Some(vertical[1]),
                            input: None,
                            status_bar,
                            split_direction: self.split_direction,
                        }
                    }
                }
            },
            ViewMode::AgentsOnly => {
                // Agents list takes full width
                LayoutAreas {
                    session_list: Some(main_area),
                    preview: None,
                    input: None,
                    status_bar,
                    split_direction: self.split_direction,
                }
            }
            ViewMode::PreviewOnly => {
                // Preview takes full width
                if show_input {
                    let vertical = ratatui::layout::Layout::default()
                        .direction(Direction::Vertical)
                        .constraints([Constraint::Min(3), Constraint::Length(self.input_height)])
                        .split(main_area);

                    LayoutAreas {
                        session_list: None,
                        preview: Some(vertical[0]),
                        input: Some(vertical[1]),
                        status_bar,
                        split_direction: self.split_direction,
                    }
                } else {
                    LayoutAreas {
                        session_list: None,
                        preview: Some(main_area),
                        input: None,
                        status_bar,
                        split_direction: self.split_direction,
                    }
                }
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
    /// Area for the session/agent list (if shown)
    pub session_list: Option<Rect>,
    /// Area for the preview panel (if shown)
    pub preview: Option<Rect>,
    /// Area for the input widget (if shown)
    pub input: Option<Rect>,
    /// Area for the status bar
    pub status_bar: Rect,
    /// Current split direction (for session list rendering)
    pub split_direction: SplitDirection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layout_calculation() {
        let layout = Layout::new();
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.session_list.is_some());
        assert!(areas.preview.is_some());
        assert!(areas.input.is_none());
        assert_eq!(areas.status_bar.height, 1);
    }

    #[test]
    fn test_layout_with_input() {
        let layout = Layout::new();
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate_with_input(area, true);

        assert!(areas.session_list.is_some());
        assert!(areas.preview.is_some());
        assert!(areas.input.is_some());
        assert_eq!(areas.input.unwrap().height, 3);
    }

    #[test]
    fn test_layout_agents_only() {
        let layout = Layout::new().with_split_offset(0);
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.session_list.is_some());
        assert!(areas.preview.is_none());
    }

    #[test]
    fn test_layout_preview_only() {
        let layout = Layout::new().with_split_offset(100);
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.session_list.is_none());
        assert!(areas.preview.is_some());
    }

    #[test]
    fn test_step_split_offset_down() {
        let mut layout = Layout::new().with_split_offset(60);
        assert_eq!(layout.view_mode(), ViewMode::Both);

        // Tab shrinks preview (expands list)
        layout.step_split_offset_down();
        assert_eq!(layout.split_offset, 50);

        // Keep stepping down to 0 (agents only)
        for _ in 0..5 {
            layout.step_split_offset_down();
        }
        assert_eq!(layout.split_offset, 0);
        assert_eq!(layout.view_mode(), ViewMode::AgentsOnly);

        // Wrap around to 100 (preview only)
        layout.step_split_offset_down();
        assert_eq!(layout.split_offset, 100);
        assert_eq!(layout.view_mode(), ViewMode::PreviewOnly);
    }

    #[test]
    fn test_step_split_offset_up() {
        let mut layout = Layout::new().with_split_offset(40);

        // Shift+Tab expands preview
        layout.step_split_offset_up();
        assert_eq!(layout.split_offset, 50);

        // Keep stepping up to 100 (preview only)
        for _ in 0..5 {
            layout.step_split_offset_up();
        }
        assert_eq!(layout.split_offset, 100);
        assert_eq!(layout.view_mode(), ViewMode::PreviewOnly);

        // Wrap around to 0 (agents only)
        layout.step_split_offset_up();
        assert_eq!(layout.split_offset, 0);
        assert_eq!(layout.view_mode(), ViewMode::AgentsOnly);
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

    #[test]
    fn test_split_direction_toggle() {
        let mut layout = Layout::new();
        assert_eq!(layout.split_direction, SplitDirection::Horizontal);

        layout.toggle_split_direction();
        assert_eq!(layout.split_direction, SplitDirection::Vertical);

        layout.toggle_split_direction();
        assert_eq!(layout.split_direction, SplitDirection::Horizontal);
    }

    #[test]
    fn test_vertical_split_layout() {
        let mut layout = Layout::new();
        layout.split_direction = SplitDirection::Vertical;
        let area = Rect::new(0, 0, 100, 50);
        let areas = layout.calculate(area);

        assert!(areas.session_list.is_some());
        assert!(areas.preview.is_some());
        assert_eq!(areas.split_direction, SplitDirection::Vertical);

        // In vertical split, session list should be on top (smaller y)
        let session_area = areas.session_list.unwrap();
        let preview_area = areas.preview.unwrap();
        assert!(session_area.y < preview_area.y);
    }

    #[test]
    fn test_with_split_offset_clamp() {
        let layout = Layout::new().with_split_offset(150);
        assert_eq!(layout.split_offset, 100);

        let layout = Layout::new().with_split_offset(0);
        assert_eq!(layout.split_offset, 0);
    }
}
