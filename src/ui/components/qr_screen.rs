//! QR code screen component for web remote control

use qrcode::{EcLevel, QrCode};
use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Style},
    text::Line,
    widgets::{Block, Borders, Clear, Paragraph},
    Frame,
};

use tmai_core::state::AppState;

/// QR code display screen
pub struct QrScreen;

impl QrScreen {
    /// Render the QR code screen as a centered popup
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let url = state.get_web_url();

        // Generate QR code to know its size
        let qr_info = url.as_ref().and_then(|u| {
            // Use low error correction for smaller QR code
            QrCode::with_error_correction_level(u.as_bytes(), EcLevel::L)
                .ok()
                .map(|code| {
                    let width = code.width();
                    // Height in terminal lines (2 pixels per line with half-blocks)
                    let height = width.div_ceil(2);
                    (code, width, height)
                })
        });

        // Calculate popup size based on QR code
        let (qr_width, qr_height) = qr_info
            .as_ref()
            .map(|(_, w, h)| (*w, *h))
            .unwrap_or((21, 11));

        // Popup size: QR + padding + title/url/instructions
        let popup_width = (qr_width as u16 + 4)
            .max(35)
            .min(area.width.saturating_sub(2));
        let popup_height = (qr_height as u16 + 6).min(area.height.saturating_sub(2));

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

        let block = Block::default()
            .title(" Web Remote Control ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Cyan));

        let inner = block.inner(popup_area);
        frame.render_widget(block, popup_area);

        match (url, qr_info) {
            (Some(url), Some((code, _, _))) => {
                Self::render_qr_content(frame, inner, &url, &code);
            }
            (Some(url), None) => {
                Self::render_qr_error(frame, inner, &url);
            }
            _ => Self::render_error(frame, inner),
        }
    }

    /// Render QR code and URL
    fn render_qr_content(frame: &mut Frame, area: Rect, url: &str, code: &QrCode) {
        let qr_string = Self::render_qr_to_string(code);
        let qr_lines: Vec<&str> = qr_string.lines().collect();
        let qr_height = qr_lines.len() as u16;

        // Layout
        let chunks = Layout::vertical([
            Constraint::Length(1),         // Title
            Constraint::Length(qr_height), // QR code
            Constraint::Length(1),         // Spacer
            Constraint::Length(1),         // URL
            Constraint::Min(1),            // Instructions
        ])
        .split(area);

        // Title
        let title = Paragraph::new("Scan with your smartphone")
            .style(Style::default().fg(Color::White))
            .alignment(Alignment::Center);
        frame.render_widget(title, chunks[0]);

        // QR code
        let qr_text: Vec<Line> = qr_lines
            .iter()
            .map(|line| Line::from(*line).style(Style::default().fg(Color::White)))
            .collect();
        let qr_widget = Paragraph::new(qr_text).alignment(Alignment::Center);
        frame.render_widget(qr_widget, chunks[1]);

        // URL (truncated if needed, Unicode-safe)
        let max_chars = area.width.saturating_sub(2) as usize;
        let display_url = if url.chars().count() > max_chars {
            let truncated: String = url.chars().take(max_chars.saturating_sub(3)).collect();
            format!("{}...", truncated)
        } else {
            url.to_string()
        };
        let url_widget = Paragraph::new(display_url)
            .style(Style::default().fg(Color::Cyan))
            .alignment(Alignment::Center);
        frame.render_widget(url_widget, chunks[3]);

        // Instructions
        let instructions = Paragraph::new("Press 'r' or Esc to close")
            .style(Style::default().fg(Color::DarkGray))
            .alignment(Alignment::Center);
        frame.render_widget(instructions, chunks[4]);
    }

    /// Render error when QR code generation failed
    fn render_qr_error(frame: &mut Frame, area: Rect, url: &str) {
        let chunks = Layout::vertical([
            Constraint::Min(1),
            Constraint::Length(2),
            Constraint::Length(1),
        ])
        .split(area);

        let error = Paragraph::new("QR code generation failed")
            .style(Style::default().fg(Color::Red))
            .alignment(Alignment::Center);
        frame.render_widget(error, chunks[0]);

        let url_widget = Paragraph::new(url.to_string())
            .style(Style::default().fg(Color::Cyan))
            .alignment(Alignment::Center);
        frame.render_widget(url_widget, chunks[1]);

        let instructions = Paragraph::new("Press 'r' or Esc to close")
            .style(Style::default().fg(Color::DarkGray))
            .alignment(Alignment::Center);
        frame.render_widget(instructions, chunks[2]);
    }

    /// Render error when URL is not available
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

    /// Convert QR code to Unicode half-block string
    fn render_qr_to_string(code: &QrCode) -> String {
        let width = code.width();
        let mut result = String::new();

        // Each character represents 2 vertical pixels using half-block chars
        for y in (0..width).step_by(2) {
            for x in 0..width {
                let top = code[(x, y)] == qrcode::Color::Dark;
                let bottom = if y + 1 < width {
                    code[(x, y + 1)] == qrcode::Color::Dark
                } else {
                    false
                };

                let ch = match (top, bottom) {
                    (true, true) => '\u{2588}',  // Full block █
                    (true, false) => '\u{2580}', // Upper half ▀
                    (false, true) => '\u{2584}', // Lower half ▄
                    (false, false) => ' ',
                };
                result.push(ch);
            }
            result.push('\n');
        }

        result
    }
}
