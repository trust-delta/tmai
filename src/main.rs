use std::sync::Arc;

use anyhow::{Context, Result};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai::config::{Config, Settings};
use tmai::ipc::server::IpcServer;
use tmai::ui::App;
use tmai::web::WebServer;
use tmai::wrap::{
    runner::{get_pane_id, PtyRunnerConfig},
    PtyRunner,
};

#[tokio::main]
async fn main() -> Result<()> {
    // Parse CLI arguments
    let cli = Config::parse_args();

    // Check for wrap subcommand (logging setup is mode-dependent)
    if cli.is_wrap_mode() {
        setup_logging(cli.debug, false); // stderr output
        return run_wrap_mode(&cli);
    }

    // Check for demo subcommand (no tmux, IPC, or web required)
    if cli.is_demo_mode() {
        setup_logging(cli.debug, true);
        let settings = tmai::config::Settings::default();
        let mut app = App::new(settings, None, None, None);
        return app.run_demo().await;
    }

    setup_logging(cli.debug, true); // file output (prevents TUI screen corruption)

    // Load settings
    let mut settings = Settings::load(cli.config.as_ref())?;
    settings.merge_cli(&cli);
    settings.validate();

    // Start IPC server
    let ipc_server = IpcServer::start()
        .await
        .context("Failed to start IPC server")?;
    let ipc_server = Arc::new(ipc_server);

    // Create audit event channel (if audit enabled)
    let (audit_tx, audit_rx) = if settings.audit.enabled {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    // Run the application with web server
    let mut app = App::new(
        settings.clone(),
        Some(ipc_server.clone()),
        audit_tx.clone(),
        audit_rx,
    );

    // Start web server if enabled
    if settings.web.enabled {
        let token = tmai::web::auth::generate_token();
        let state = app.shared_state();

        // Initialize web settings in app state
        {
            let mut app_state = state.write();
            app_state.init_web(token.clone(), settings.web.port);
        }

        // Start web server in background
        let web_server = WebServer::new(
            settings.clone(),
            state,
            token,
            Some(ipc_server.clone()),
            audit_tx,
        );
        web_server.start();
    }

    app.run().await
}

/// Run in wrap mode (PTY proxy for AI agent)
fn run_wrap_mode(cli: &Config) -> Result<()> {
    let (command, args) = cli.get_wrap_args().ok_or_else(|| {
        anyhow::anyhow!("No command specified for wrap mode. Usage: tmai wrap <command> [args...]")
    })?;

    tracing::debug!("Wrapping command: {} {:?}", command, args);

    // Load settings for exfil detection config
    let settings = Settings::load(cli.config.as_ref()).unwrap_or_default();

    // Set up raw terminal mode
    let _raw_guard = setup_raw_mode()?;

    // Create runner config
    let config = PtyRunnerConfig {
        command,
        args,
        id: get_pane_id(),
        exfil_detection: settings.exfil_detection,
        ..Default::default()
    };

    // Run the PTY wrapper
    let runner = PtyRunner::new(config);
    let exit_code = runner.run()?;

    std::process::exit(exit_code);
}

/// Set up raw terminal mode and return a guard that restores on drop
fn setup_raw_mode() -> Result<RawModeGuard> {
    use nix::sys::termios::OutputFlags;
    use std::os::fd::AsFd;

    let stdin = std::io::stdin();
    let stdin_fd = stdin.as_fd();
    let original = nix::sys::termios::tcgetattr(stdin_fd)?;

    let mut raw = original.clone();
    nix::sys::termios::cfmakeraw(&mut raw);

    // Re-enable output post-processing for proper newline handling.
    // cfmakeraw disables OPOST, which causes LF-only output from the child PTY
    // to not move the cursor to the beginning of the line (staircase effect).
    // OPOST + ONLCR ensures LF is converted to CR+LF for correct display.
    raw.output_flags.insert(OutputFlags::OPOST);
    raw.output_flags.insert(OutputFlags::ONLCR);

    nix::sys::termios::tcsetattr(stdin_fd, nix::sys::termios::SetArg::TCSANOW, &raw)?;

    Ok(RawModeGuard { original })
}

/// Guard that restores terminal mode on drop
struct RawModeGuard {
    original: nix::sys::termios::Termios,
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        use std::os::fd::AsFd;
        let stdin = std::io::stdin();
        let _ = nix::sys::termios::tcsetattr(
            stdin.as_fd(),
            nix::sys::termios::SetArg::TCSANOW,
            &self.original,
        );
    }
}

/// Setup tracing subscriber.
/// - `log_to_file`: TUIモード時はファイル出力（画面崩れ防止）、wrapモード時はstderr出力。
fn setup_logging(debug: bool, log_to_file: bool) {
    let filter = if debug {
        EnvFilter::new("tmai=debug")
    } else {
        EnvFilter::new("tmai=info")
    };

    if log_to_file {
        // TUIモード: ファイルに出力（$STATE_DIR/tmai.log）
        let log_dir = tmai::ipc::protocol::state_dir();
        let _ = std::fs::create_dir_all(&log_dir);
        let log_file =
            std::fs::File::create(log_dir.join("tmai.log")).expect("Failed to create log file");
        tracing_subscriber::registry()
            .with(filter)
            .with(
                tracing_subscriber::fmt::layer()
                    .with_target(false)
                    .with_ansi(false)
                    .with_writer(log_file),
            )
            .init();
    } else {
        // Wrapモード: stderr（従来通り）
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().with_target(false))
            .init();
    }
}
