//! Pipe-pane log reader with vt100 terminal emulation.
//!
//! Reads raw terminal output captured by `tmux pipe-pane` and processes it
//! through a `vt100::Parser` to produce clean, renderable ANSI output.
//! This eliminates raw cursor movement sequences, screen clears, etc.,
//! leaving only meaningful text with color/style ANSI codes.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use parking_lot::RwLock;
use tracing::debug;

/// State for a single pipe-pane log file
pub struct PipeLogState {
    /// Path to the log file
    pub path: String,
    /// Pane target (e.g. "main:0.1")
    pub target: String,
    /// Last read position in the file (byte offset)
    pub last_read_pos: u64,
    /// vt100 parser instance (accumulates terminal state)
    parser: vt100::Parser,
    /// Cached ANSI output (regenerated on new data)
    pub ansi_output: String,
}

impl PipeLogState {
    /// Create a new PipeLogState for the given pane.
    ///
    /// `rows` and `cols` set the virtual terminal dimensions for the vt100 parser.
    pub fn new(path: String, target: String, rows: u16, cols: u16) -> Self {
        Self {
            path,
            target,
            last_read_pos: 0,
            parser: vt100::Parser::new(rows, cols, 1000), // 1000 lines scrollback
            ansi_output: String::new(),
        }
    }
}

/// Shared registry: pane_id → PipeLogState
pub type PipeLogRegistry = Arc<RwLock<HashMap<String, PipeLogState>>>;

/// Create a new empty pipe-log registry
pub fn new_pipe_log_registry() -> PipeLogRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Read new data from a pipe-pane log file and process through vt100.
///
/// Returns `true` if new data was processed.
pub fn poll_pipe_log(state: &mut PipeLogState) -> bool {
    let path = Path::new(&state.path);
    if !path.exists() {
        return false;
    }

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return false,
    };

    let current_size = metadata.len();
    if current_size <= state.last_read_pos {
        if current_size < state.last_read_pos {
            // File was truncated — reset
            debug!(path = %state.path, "Pipe log truncated, resetting");
            state.last_read_pos = 0;
            state.parser = vt100::Parser::new(
                state.parser.screen().size().0,
                state.parser.screen().size().1,
                1000,
            );
        }
        return false;
    }

    let mut reader = std::io::BufReader::new(file);
    if reader.seek(SeekFrom::Start(state.last_read_pos)).is_err() {
        return false;
    }

    let mut buf = Vec::with_capacity((current_size - state.last_read_pos) as usize);
    if reader.read_to_end(&mut buf).is_err() {
        return false;
    }

    if buf.is_empty() {
        return false;
    }

    // Feed raw bytes through vt100 terminal emulator
    state.parser.process(&buf);

    // Extract the rendered screen content with ANSI codes
    state.ansi_output = screen_to_ansi(state.parser.screen());
    state.last_read_pos = current_size;

    true
}

/// Convert a vt100 screen to a string with ANSI color/style escape codes.
///
/// Iterates through each row of the screen and emits ANSI SGR sequences
/// for foreground/background colors, bold, underline, etc.
fn screen_to_ansi(screen: &vt100::Screen) -> String {
    let (rows, cols) = screen.size();
    let mut output = String::new();
    let mut trailing_blank_rows = 0;

    for row in 0..rows {
        let mut line = String::new();
        let mut current_attrs = CellAttrs::default();

        for col in 0..cols {
            let cell = screen.cell(row, col).unwrap();
            let attrs = CellAttrs::from_cell(&cell);

            if attrs != current_attrs {
                // Emit SGR reset + new attributes
                line.push_str("\x1b[0");
                attrs.write_sgr(&mut line);
                line.push('m');
                current_attrs = attrs;
            }

            let ch = cell.contents();
            if ch.is_empty() {
                line.push(' ');
            } else {
                line.push_str(&ch);
            }
        }

        // Reset at end of line if we had attributes
        if current_attrs != CellAttrs::default() {
            line.push_str("\x1b[0m");
        }

        // Trim trailing spaces
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            trailing_blank_rows += 1;
        } else {
            // Flush any accumulated blank rows
            for _ in 0..trailing_blank_rows {
                output.push('\n');
            }
            trailing_blank_rows = 0;

            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(trimmed);
        }
    }

    output
}

/// Extracted cell attributes for SGR comparison
#[derive(Clone, PartialEq, Eq)]
struct CellAttrs {
    fg: vt100::Color,
    bg: vt100::Color,
    bold: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

impl Default for CellAttrs {
    fn default() -> Self {
        Self {
            fg: vt100::Color::Default,
            bg: vt100::Color::Default,
            bold: false,
            italic: false,
            underline: false,
            inverse: false,
        }
    }
}

impl CellAttrs {
    fn from_cell(cell: &vt100::Cell) -> Self {
        Self {
            fg: cell.fgcolor(),
            bg: cell.bgcolor(),
            bold: cell.bold(),
            italic: cell.italic(),
            underline: cell.underline(),
            inverse: cell.inverse(),
        }
    }

    fn write_sgr(&self, out: &mut String) {
        if self.bold {
            out.push_str(";1");
        }
        if self.italic {
            out.push_str(";3");
        }
        if self.underline {
            out.push_str(";4");
        }
        if self.inverse {
            out.push_str(";7");
        }
        if self.fg != vt100::Color::Default {
            write_color_sgr(out, &self.fg, false);
        }
        if self.bg != vt100::Color::Default {
            write_color_sgr(out, &self.bg, true);
        }
    }
}

fn write_color_sgr(out: &mut String, color: &vt100::Color, is_bg: bool) {
    let base = if is_bg { 40 } else { 30 };
    match color {
        vt100::Color::Default => {}
        vt100::Color::Idx(idx) => {
            if *idx < 8 {
                out.push_str(&format!(";{}", base + idx));
            } else if *idx < 16 {
                out.push_str(&format!(";{}", base + 60 + idx - 8));
            } else {
                // 256-color
                out.push_str(&format!(";{}8;5;{}", if is_bg { 4 } else { 3 }, idx));
            }
        }
        vt100::Color::Rgb(r, g, b) => {
            out.push_str(&format!(
                ";{}8;2;{};{};{}",
                if is_bg { 4 } else { 3 },
                r,
                g,
                b
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_pipe_log_state() {
        let state = PipeLogState::new("/tmp/test.log".to_string(), "main:0.1".to_string(), 24, 80);
        assert_eq!(state.last_read_pos, 0);
        assert!(state.ansi_output.is_empty());
    }

    #[test]
    fn test_screen_to_ansi_empty() {
        let parser = vt100::Parser::new(24, 80, 0);
        let result = screen_to_ansi(parser.screen());
        assert!(result.is_empty());
    }

    #[test]
    fn test_screen_to_ansi_plain_text() {
        let mut parser = vt100::Parser::new(24, 80, 0);
        parser.process(b"Hello, World!");
        let result = screen_to_ansi(parser.screen());
        assert!(result.contains("Hello, World!"));
    }

    #[test]
    fn test_screen_to_ansi_with_colors() {
        let mut parser = vt100::Parser::new(24, 80, 0);
        // Red text
        parser.process(b"\x1b[31mRed text\x1b[0m Normal");
        let result = screen_to_ansi(parser.screen());
        assert!(result.contains("Red text"));
        assert!(result.contains("Normal"));
        // Should contain SGR sequences
        assert!(result.contains("\x1b["));
    }

    #[test]
    fn test_poll_pipe_log_nonexistent() {
        let mut state = PipeLogState::new(
            "/tmp/nonexistent_pipe_log_test_12345.log".to_string(),
            "main:0.1".to_string(),
            24,
            80,
        );
        assert!(!poll_pipe_log(&mut state));
    }

    #[test]
    fn test_poll_pipe_log_with_file() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        std::fs::write(&path, "Hello from pipe-pane\r\n").unwrap();

        let mut state = PipeLogState::new(path, "main:0.1".to_string(), 24, 80);
        assert!(poll_pipe_log(&mut state));
        assert!(state.ansi_output.contains("Hello from pipe-pane"));
    }
}
