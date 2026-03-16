use std::sync::Arc;

use anyhow::{Context, Result};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai::ui::App;
use tmai::web::WebServer;
use tmai_core::api::TmaiCoreBuilder;
use tmai_core::command_sender::CommandSender;
use tmai_core::config::{Config, Settings};
use tmai_core::ipc::server::IpcServer;
use tmai_core::runtime::{RuntimeAdapter, TmuxAdapter};
use tmai_core::wrap::{
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

    // Check for audit subcommand (non-async, no TUI/Web)
    if cli.is_audit_mode() {
        match cli.get_audit_command() {
            Some(subcommand) => {
                tmai::audit::run(subcommand);
                return Ok(());
            }
            None => {
                anyhow::bail!(
                    "Usage: tmai audit <stats|misdetections|disagreements>\n\
                     Run `tmai audit --help` for details."
                );
            }
        }
    }

    // Check for codex-hook bridge subcommand (no logging, fast path)
    if cli.is_codex_hook_mode() {
        let settings = Settings::load(cli.config.as_ref()).unwrap_or_default();
        let token = tmai::init::load_hook_token().unwrap_or_default();
        return tmai::codex_hook::run(settings.web.port, &token);
    }

    // Check for init subcommand
    if cli.is_init_mode() {
        tmai::init::run(cli.get_init_force())?;
        if cli.get_init_codex() {
            tmai::init::run_codex_init(cli.get_init_force())?;
        }
        return Ok(());
    }

    // Check for uninit subcommand
    if cli.is_uninit_mode() {
        tmai::init::run_uninit()?;
        if cli.get_uninit_codex() {
            tmai::init::run_codex_uninit()?;
        }
        return Ok(());
    }

    // Check for demo subcommand (no tmux, IPC, or web required)
    if cli.is_demo_mode() {
        setup_logging(cli.debug, true);
        let settings = tmai_core::config::Settings::default();
        let runtime: Arc<dyn RuntimeAdapter> =
            Arc::new(tmai_core::runtime::StandaloneAdapter::new());
        let mut app = App::new(settings, None, runtime, None, None);
        return app.run_demo().await;
    }

    // Load settings
    let mut settings = Settings::load(cli.config.as_ref())?;
    settings.merge_cli(&cli);
    settings.validate();

    // Web-only mode: skip TUI, run web server + monitoring loop only
    if cli.web_only {
        setup_logging(cli.debug, false); // stderr output (no TUI to corrupt)
        return run_web_only_mode(settings).await;
    }

    setup_logging(cli.debug, true); // file output (prevents TUI screen corruption)

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

    // Create runtime adapter (tmux for TUI mode)
    let runtime: Arc<dyn RuntimeAdapter> = Arc::new(TmuxAdapter::new(settings.capture_lines));

    // Run the application with web server
    let mut app = App::new(
        settings.clone(),
        Some(ipc_server.clone()),
        runtime.clone(),
        audit_tx.clone(),
        audit_rx,
    );

    // Build TmaiCore facade (shared between Web and TUI for event broadcasting)
    let app_state = app.shared_state();

    // Create hook registry and load hook token
    let hook_registry = tmai_core::hooks::new_hook_registry();
    let session_pane_map = tmai_core::hooks::new_session_pane_map();
    let hook_token = tmai::init::load_hook_token();

    let core_cmd_sender = Arc::new(
        CommandSender::new(Some(ipc_server.clone()), runtime.clone(), app_state.clone())
            .with_hook_registry(hook_registry.clone()),
    );

    let mut core_builder = TmaiCoreBuilder::new(settings.clone())
        .with_state(app_state.clone())
        .with_ipc_server(ipc_server.clone())
        .with_command_sender(core_cmd_sender)
        .with_hook_registry(hook_registry)
        .with_session_pane_map(session_pane_map);

    if let Some(token) = hook_token {
        if settings.web.enabled {
            tracing::info!("Hook token loaded, HTTP hook endpoint enabled");
        } else {
            tracing::info!(
                "Hook token loaded, but web server is disabled — hooks will not receive events"
            );
        }
        core_builder = core_builder.with_hook_token(token.clone());
    }

    if let Some(ref tx) = audit_tx {
        core_builder = core_builder.with_audit_sender(tx.clone());
    }

    let core = Arc::new(core_builder.build());

    // Share core with App for event broadcasting
    app.set_core(core.clone());

    // Start web server if enabled
    if settings.web.enabled {
        let token = tmai::web::auth::generate_token();

        // Initialize web settings in app state
        {
            let mut app_state = app_state.write();
            app_state.init_web(token.clone(), settings.web.port);
        }

        // Start web server in background
        let web_server = WebServer::new(settings.clone(), core.clone(), token);
        web_server.start();
    }

    // Start review service if enabled
    if settings.review.enabled {
        // Build notification info for review completion reporting
        let review_notification = if settings.web.enabled {
            core.hook_token().map(|token| {
                std::sync::Arc::new(tmai_core::review::types::ReviewNotification {
                    port: settings.web.port,
                    token: token.to_string(),
                    source_target: String::new(), // filled per-request
                })
            })
        } else {
            None
        };

        tmai_core::review::ReviewService::spawn(
            std::sync::Arc::new(settings.review.clone()),
            app.shared_state(),
            core.subscribe(),
            core.event_sender(),
            review_notification,
        );
    }

    // Start Codex CLI app-server WebSocket connections if configured
    if !settings.codex_ws.connections.is_empty() {
        let codex_ws_service = tmai_core::codex_ws::CodexWsService::new(
            &settings.codex_ws.connections,
            core.hook_registry().clone(),
            core.event_sender(),
            app_state.clone(),
        );
        codex_ws_service.start();
    }

    // Start auto-approve service if mode is not Off
    if settings.auto_approve.effective_mode()
        != tmai_core::auto_approve::types::AutoApproveMode::Off
    {
        let service = tmai_core::auto_approve::AutoApproveService::new(
            settings.auto_approve.clone(),
            app.shared_state(),
            CommandSender::new(
                Some(ipc_server.clone()),
                runtime.clone(),
                app.shared_state(),
            )
            .with_hook_registry(core.hook_registry().clone()),
            audit_tx,
        );
        service.start();
    }

    app.run().await
}

/// Run in web-only mode (no tmux, no TUI — hooks/IPC + web server only)
async fn run_web_only_mode(settings: Settings) -> Result<()> {
    use tmai_core::runtime::StandaloneAdapter;

    eprintln!("tmai: starting in web-only mode (no tmux required)");

    // Start IPC server
    let ipc_server = IpcServer::start()
        .await
        .context("Failed to start IPC server")?;
    let ipc_server = Arc::new(ipc_server);

    // Create standalone runtime (no tmux)
    let runtime: Arc<dyn RuntimeAdapter> = Arc::new(StandaloneAdapter::new());

    // Create shared state
    let state = tmai_core::state::AppState::shared();
    {
        let mut s = state.write();
        s.show_activity_name = settings.ui.show_activity_name;
    }

    // Create hook registry and load token
    let hook_registry = tmai_core::hooks::new_hook_registry();

    // Create command sender (IPC → PTY inject → standalone error)
    let cmd_sender = Arc::new(
        CommandSender::new(Some(ipc_server.clone()), runtime.clone(), state.clone())
            .with_hook_registry(hook_registry.clone()),
    );
    let session_pane_map = tmai_core::hooks::new_session_pane_map();
    let hook_token = tmai::init::load_hook_token();

    // Build TmaiCore facade
    let mut core_builder = TmaiCoreBuilder::new(settings.clone())
        .with_state(state.clone())
        .with_ipc_server(ipc_server.clone())
        .with_command_sender(cmd_sender)
        .with_hook_registry(hook_registry.clone())
        .with_session_pane_map(session_pane_map);

    if let Some(token) = hook_token {
        eprintln!("tmai: hook token loaded, hook endpoint enabled");
        core_builder = core_builder.with_hook_token(token);
    } else {
        eprintln!("tmai: no hook token found — run `tmai init` to enable hooks");
    }

    let core = Arc::new(core_builder.build());

    // Start web server (required for web-only mode)
    if !settings.web.enabled {
        anyhow::bail!("web-only mode requires web server to be enabled ([web] enabled = true)");
    }

    let token = tmai::web::auth::generate_token();
    {
        let mut s = state.write();
        s.init_web(token.clone(), settings.web.port);
    }

    let port = settings.web.port;
    let web_server = WebServer::new(settings.clone(), core.clone(), token.clone());
    web_server.start();

    eprintln!(
        "tmai: web server running at http://localhost:{}/?token={}",
        port, token
    );
    eprintln!("tmai: waiting for hook events from Claude Code...");
    eprintln!("tmai: press Ctrl+C to stop");

    // Start monitoring loop (Poller with standalone runtime)
    let ipc_registry = ipc_server.registry();
    let mut poller = tmai_core::monitor::Poller::new(
        settings.clone(),
        state.clone(),
        runtime,
        ipc_registry,
        hook_registry,
        None,
    );
    poller = poller.with_event_tx(core.event_sender().clone());

    // Run poller in background
    let mut poll_rx = poller.start();

    // Main loop: process poll messages and update state until shutdown
    loop {
        tokio::select! {
            msg = poll_rx.recv() => {
                match msg {
                    Some(tmai_core::monitor::PollMessage::AgentsUpdated(agents)) => {
                        {
                            let mut s = state.write();
                            s.update_agents(agents);
                            s.clear_error();
                        }
                        core.notify_agents_updated();
                    }
                    Some(tmai_core::monitor::PollMessage::Error(err)) => {
                        let mut s = state.write();
                        s.error_message = Some(err);
                    }
                    None => break, // Poller channel closed
                }
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\ntmai: shutting down...");
                break;
            }
        }
    }

    Ok(())
}

/// Run in wrap mode (PTY proxy for AI agent)
fn run_wrap_mode(cli: &Config) -> Result<()> {
    let (command, args) = cli.get_wrap_args().ok_or_else(|| {
        anyhow::anyhow!("No command specified for wrap mode. Usage: tmai wrap <command> [args...]")
    })?;

    tracing::debug!("Wrapping command: {} {:?}", command, args);

    // Load settings for exfil detection config
    let mut settings = Settings::load(cli.config.as_ref()).unwrap_or_default();
    settings.validate();

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
        EnvFilter::new("tmai=debug,tmai_core=debug")
    } else {
        EnvFilter::new("tmai=info,tmai_core=info")
    };

    if log_to_file {
        // TUIモード: ファイルに出力（$STATE_DIR/tmai.log）
        let log_dir = tmai_core::ipc::protocol::state_dir();
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
