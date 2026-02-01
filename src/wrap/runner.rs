//! PTY runner for wrapping AI agents
//!
//! Creates a PTY and runs the specified command, proxying I/O while monitoring state.

use anyhow::{Context, Result};
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::wrap::analyzer::Analyzer;
use crate::wrap::state_file::{StateFile, WrapState};

/// PTY runner configuration
pub struct PtyRunnerConfig {
    /// Command to run
    pub command: String,
    /// Arguments
    pub args: Vec<String>,
    /// Unique ID for state file (e.g., tmux pane ID or UUID)
    pub id: String,
    /// Initial PTY size
    pub rows: u16,
    /// Initial PTY columns
    pub cols: u16,
}

impl Default for PtyRunnerConfig {
    fn default() -> Self {
        Self {
            command: String::new(),
            args: Vec::new(),
            id: uuid::Uuid::new_v4().to_string(),
            rows: 24,
            cols: 80,
        }
    }
}

/// PTY runner that wraps an AI agent
pub struct PtyRunner {
    config: PtyRunnerConfig,
}

impl PtyRunner {
    /// Create a new PTY runner
    pub fn new(config: PtyRunnerConfig) -> Self {
        Self { config }
    }

    /// Run the wrapped command
    pub fn run(self) -> Result<i32> {
        // Get terminal size from the current terminal
        let (rows, cols) = get_terminal_size().unwrap_or((self.config.rows, self.config.cols));

        // Create PTY
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY")?;

        // Build command
        let mut cmd = CommandBuilder::new(&self.config.command);
        cmd.args(&self.config.args);

        // Set working directory to current directory
        if let Ok(cwd) = std::env::current_dir() {
            cmd.cwd(cwd);
        }

        // Spawn child process
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command")?;
        let child_pid = child.process_id().unwrap_or(0);

        tracing::debug!("Spawned {} with PID {}", self.config.command, child_pid);

        // Create state file
        let state_file =
            Arc::new(StateFile::new(&self.config.id).context("Failed to create state file")?);

        // Create analyzer
        let analyzer = Arc::new(parking_lot::Mutex::new(Analyzer::new(child_pid)));

        // Flag for shutdown
        let running = Arc::new(AtomicBool::new(true));

        // Get PTY master for read/write
        let mut master_reader = pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let mut master_writer = pair
            .master
            .take_writer()
            .context("Failed to take PTY writer")?;

        // Thread: Read from PTY master -> write to stdout
        let analyzer_out = analyzer.clone();
        let running_out = running.clone();
        let output_thread = thread::spawn(move || {
            let mut stdout = std::io::stdout();
            let mut buf = [0u8; 4096];

            while running_out.load(Ordering::Relaxed) {
                match master_reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        // Write to stdout
                        if stdout.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        let _ = stdout.flush();

                        // Process for state detection (convert to string, ignoring invalid UTF-8)
                        if let Ok(s) = std::str::from_utf8(&buf[..n]) {
                            analyzer_out.lock().process_output(s);
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            tracing::debug!("PTY read error: {}", e);
                            break;
                        }
                    }
                }
            }
        });

        // Thread: Read from stdin -> write to PTY master
        let analyzer_in = analyzer.clone();
        let running_in = running.clone();
        let input_thread = thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut stdin = stdin.lock();
            let mut buf = [0u8; 1024];

            while running_in.load(Ordering::Relaxed) {
                match stdin.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        // Write to PTY
                        if master_writer.write_all(&buf[..n]).is_err() {
                            break;
                        }
                        let _ = master_writer.flush();

                        // Process for state detection
                        if let Ok(s) = std::str::from_utf8(&buf[..n]) {
                            analyzer_in.lock().process_input(s);
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock {
                            tracing::debug!("stdin read error: {}", e);
                            break;
                        }
                    }
                }
            }
        });

        // Thread: Periodic state file update with change detection
        let analyzer_state = analyzer.clone();
        let running_state = running.clone();
        let state_file_state = state_file.clone();
        let state_thread = thread::spawn(move || {
            let mut last_state: Option<WrapState> = None;

            while running_state.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));

                let state = analyzer_state.lock().get_state();

                // Only write if state has changed
                let should_write = match &last_state {
                    None => true,
                    Some(prev) => !states_equal(prev, &state),
                };

                if should_write {
                    if let Err(e) = state_file_state.write(&state) {
                        tracing::debug!("Failed to write state file: {}", e);
                    }
                    last_state = Some(state);
                }
            }
        });

        // Thread: Periodic terminal size check for resize
        // Instead of using SIGWINCH signal handler (which requires unsafe TLS access),
        // we poll for terminal size changes. This is simpler and avoids undefined behavior.
        let running_resize = running.clone();
        let pty_master = pair.master;
        let resize_thread = thread::spawn(move || {
            let mut last_size: Option<(u16, u16)> = get_terminal_size();

            while running_resize.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));

                let current_size = get_terminal_size();
                if current_size != last_size {
                    if let Some((rows, cols)) = current_size {
                        let _ = pty_master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                    last_size = current_size;
                }
            }
        });

        // Wait for child to exit
        let exit_status = child.wait().context("Failed to wait for child")?;

        // Write final state before signaling threads to stop
        {
            let final_state = analyzer.lock().get_state();
            if let Err(e) = state_file.write(&final_state) {
                tracing::debug!("Failed to write final state: {}", e);
            }
        }

        // Signal threads to stop
        running.store(false, Ordering::Relaxed);

        // Wait for threads with timeout to avoid hanging on blocked stdin
        join_thread_with_timeout(output_thread, Duration::from_secs(1));
        join_thread_with_timeout(input_thread, Duration::from_secs(1));
        join_thread_with_timeout(state_thread, Duration::from_secs(1));
        join_thread_with_timeout(resize_thread, Duration::from_secs(1));

        // Return exit code
        Ok(exit_status.exit_code() as i32)
    }
}

/// Compare two WrapState instances for equality (ignoring timestamps)
fn states_equal(a: &WrapState, b: &WrapState) -> bool {
    a.status == b.status
        && a.approval_type == b.approval_type
        && a.details == b.details
        && a.choices == b.choices
        && a.multi_select == b.multi_select
        && a.cursor_position == b.cursor_position
        && a.pid == b.pid
        && a.pane_id == b.pane_id
}

/// Join a thread with a timeout, abandoning it if it doesn't finish in time
fn join_thread_with_timeout<T>(handle: JoinHandle<T>, timeout: Duration) {
    let start = Instant::now();
    loop {
        if handle.is_finished() {
            let _ = handle.join();
            return;
        }
        if start.elapsed() >= timeout {
            tracing::debug!("Thread join timed out, abandoning thread");
            // Thread will be leaked but we can't block forever
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// Get current terminal size
fn get_terminal_size() -> Option<(u16, u16)> {
    use nix::libc;

    // Try to get size from STDOUT
    let fd = libc::STDOUT_FILENO;
    let mut size: libc::winsize = unsafe { std::mem::zeroed() };

    let result = unsafe { libc::ioctl(fd, libc::TIOCGWINSZ, &mut size) };

    if result == 0 && size.ws_row > 0 && size.ws_col > 0 {
        Some((size.ws_row, size.ws_col))
    } else {
        None
    }
}

/// Forward a signal to the child process
pub fn forward_signal_to_child(child_pid: u32, sig: Signal) -> Result<()> {
    if child_pid > 0 {
        signal::kill(Pid::from_raw(child_pid as i32), sig).context("Failed to forward signal")?;
    }
    Ok(())
}

/// Parse command string into command and arguments
///
/// Splits the input string by whitespace. Does not handle quoted strings
/// or shell escaping - for complex commands, pass them as pre-parsed arguments.
pub fn parse_command(cmd_str: &str) -> (String, Vec<String>) {
    let parts: Vec<&str> = cmd_str.split_whitespace().collect();
    if parts.is_empty() {
        return (String::new(), Vec::new());
    }

    let command = parts[0].to_string();
    let args: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();

    (command, args)
}

/// Determine the pane ID from environment or generate one
pub fn get_pane_id() -> String {
    // Try TMUX_PANE environment variable
    if let Ok(pane) = std::env::var("TMUX_PANE") {
        // TMUX_PANE is like "%0", "%1", etc.
        // We want just the number
        return pane.trim_start_matches('%').to_string();
    }

    // Fall back to UUID
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_command_simple() {
        let (cmd, args) = parse_command("claude");
        assert_eq!(cmd, "claude");
        assert!(args.is_empty());
    }

    #[test]
    fn test_parse_command_with_args() {
        let (cmd, args) = parse_command("claude --debug --config test.toml");
        assert_eq!(cmd, "claude");
        assert_eq!(args, vec!["--debug", "--config", "test.toml"]);
    }

    #[test]
    fn test_parse_command_empty() {
        let (cmd, args) = parse_command("");
        assert!(cmd.is_empty());
        assert!(args.is_empty());
    }

    #[test]
    fn test_get_pane_id_fallback() {
        // When not in tmux, should return UUID
        let id = get_pane_id();
        assert!(!id.is_empty());
    }
}
