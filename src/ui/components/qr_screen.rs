//! QR code screen component for web remote control

use qrcode::QrCode;
use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};

use crate::state::AppState;

/// QR code display screen
pub struct QrScreen;

impl QrScreen {
    /// Render the QR code screen as a centered popup
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        // Calculate popup area (centered, fixed size)
        let popup_width = 60.min(area.width.saturating_sub(4));
        let popup_height = 35.min(area.height.saturating_sub(4));

        let popup_x = (area.width.saturating_sub(popup_width)) / 2;
        let popup_y = (area.height.saturating_sub(popup_height)) / 2;

        let popup_area = Rect::new(
            area.x + popup_x,
            area.y + popup_y,
            popup_width,
            popup_height,
        );

        // Clear background
        frame.render_widget(Clear, popup_area);

        // Get URL
        let url = state.get_web_url();

        let block = Block::default()
            .title(" Web Remote Control ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan));

        let inner = block.inner(popup_area);
        frame.render_widget(block, popup_area);

        match url {
            Some(url) => Self::render_qr_content(frame, inner, &url),
            None => Self::render_error(frame, inner),
        }
    }

    /// Render QR code and URL
    fn render_qr_content(frame: &mut Frame, area: Rect, url: &str) {
        // Layout: QR code area + URL + instructions
        let chunks = Layout::vertical([
            Constraint::Length(2),  // Title
            Constraint::Min(10),    // QR code
            Constraint::Length(3),  // URL
            Constraint::Length(2),  // Instructions
        ])
        .split(area);

        // Title
        let title = Paragraph::new("Scan with your smartphone")
            .style(Style::default().fg(Color::White))
            .alignment(Alignment::Center);
        frame.render_widget(title, chunks[0]);

        // QR code
        if let Ok(code) = QrCode::new(url.as_bytes()) {
            let qr_string = Self::render_qr_to_string(&code);
            let qr_lines: Vec<Line> = qr_string
                .lines()
                .map(|line| Line::from(Span::styled(line, Style::default().fg(Color::White))))
                .collect();

            let qr_widget = Paragraph::new(qr_lines).alignment(Alignment::Center);
            frame.render_widget(qr_widget, chunks[1]);
        } else {
            let error = Paragraph::new("Failed to generate QR code")
                .style(Style::default().fg(Color::Red))
                .alignment(Alignment::Center);
            frame.render_widget(error, chunks[1]);
        }

        // URL (truncated if too long)
        let display_url = if url.len() > (area.width as usize - 4) {
            format!("{}...", &url[..area.width as usize - 7])
        } else {
            url.to_string()
        };
        let url_widget = Paragraph::new(display_url)
            .style(Style::default().fg(Color::Cyan))
            .alignment(Alignment::Center);
        frame.render_widget(url_widget, chunks[2]);

        // Instructions
        let instructions = Paragraph::new("Press 'r' or Esc to close")
            .style(Style::default().fg(Color::DarkGray))
            .alignment(Alignment::Center);
        frame.render_widget(instructions, chunks[3]);
    }

    /// Render error message when URL is not available
    fn render_error(frame: &mut Frame, area: Rect) {
        let error = Paragraph::new(vec![
            Line::from("Web server not initialized"),
            Line::from(""),
            Line::from("Check settings.web.enabled in config"),
        ])
        .style(Style::default().fg(Color::Red))
        .alignment(Alignment::Center);
        frame.render_widget(error, area);
    }

    /// Convert QR code to Unicode block string
    fn render_qr_to_string(code: &QrCode) -> String {
        let width = code.width();
        let mut result = String::new();

        // Use Unicode block characters for compact display
        // Each character represents 2 vertical pixels
        for y in (0..width).step_by(2) {
            for x in 0..width {
                let top = code[(x, y)] == qrcode::Color::Dark;
                let bottom = if y + 1 < width {
                    code[(x, y + 1)] == qrcode::Color::Dark
                } else {
                    false
                };

                let char = match (top, bottom) {
                    (true, true) => '\u{2588}',   // Full block
                    (true, false) => '\u{2580}',  // Upper half block
                    (false, true) => '\u{2584}',  // Lower half block
                    (false, false) => ' ',        // Space
                };
                result.push(char);
            }
            result.push('\n');
        }

        result
    }
}
