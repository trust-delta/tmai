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

    // Check for MCP server subcommand (stdio transport, no logging to stdout)
    if cli.is_mcp_mode() {
        return tmai::mcp::run().await;
    }

    // Check for codex-hook bridge subcommand (no logging, fast path)
    if cli.is_codex_hook_mode() {
        let settings = Settings::load(cli.config.as_ref()).unwrap_or_default();
        let token = tmai::init::load_hook_token().unwrap_or_default();
        return tmai::codex_hook::run(settings.web.port, &token);
    }

    // Check for inter-agent CLI commands (agents/output/send)
    if let Some(cmd) = cli.get_agent_command() {
        return run_agent_command(cmd.clone());
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

    // Tmux TUI mode: ratatui TUI with tmux backend (opt-in via --tmux)
    if cli.tmux {
        setup_logging(cli.debug, true); // file output (prevents TUI screen corruption)
        return run_tmux_mode(settings, cli).await;
    }

    // Default: WebUI mode
    setup_logging(cli.debug, true); // file output (WebUI mode)
    run_webui_mode(settings, cli.debug).await
}

/// Run in tmux TUI mode (ratatui TUI with tmux backend, opt-in via --tmux)
async fn run_tmux_mode(settings: Settings, _cli: Config) -> Result<()> {
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

    // Create shared transcript registry for TUI mode
    let tui_transcript_registry = tmai_core::transcript::watcher::new_transcript_registry();

    let mut core_builder = TmaiCoreBuilder::new(settings.clone())
        .with_state(app_state.clone())
        .with_ipc_server(ipc_server.clone())
        .with_command_sender(core_cmd_sender)
        .with_hook_registry(hook_registry)
        .with_session_pane_map(session_pane_map)
        .with_transcript_registry(tui_transcript_registry)
        .with_runtime(runtime.clone());

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

    // Auto-fetch usage stats if enabled in settings
    core.start_initial_usage_fetch();

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
        let web_server = WebServer::new(settings.clone(), core.clone(), token.clone());
        web_server.start();

        // Write API connection info for MCP server
        if let Err(e) = tmai::mcp::client::write_api_info(settings.web.port, &token) {
            eprintln!("tmai: warning: failed to write API info: {e}");
        }
    }

    // Start review service if enabled
    if settings.review.enabled {
        let review_notification = if settings.web.enabled {
            core.hook_token().map(|token| {
                std::sync::Arc::new(tmai_core::review::types::ReviewNotification {
                    port: settings.web.port,
                    token: token.to_string(),
                    source_target: String::new(),
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

    // Start orchestrator notifier if enabled
    if settings.orchestrator.enabled {
        // Legacy mode — OrchestratorNotifier
        let notify_settings = std::sync::Arc::new(parking_lot::RwLock::new(
            settings.orchestrator.notify.clone(),
        ));
        // Store in state for hot-reload from WebUI settings API
        app.shared_state().write().notify_settings = Some(notify_settings.clone());
        tmai_core::orchestrator_notify::OrchestratorNotifier::spawn(
            notify_settings,
            app.shared_state(),
            core.subscribe(),
            core.event_sender(),
        );
    }

    // Start auto-cleanup service (rule-based agent/worktree cleanup on PR close)
    tmai_core::auto_cleanup::AutoCleanupService::spawn(
        app.shared_state(),
        core.subscribe(),
        core.event_sender(),
    );

    // Start task metadata milestone service (records events to .task-meta/ files)
    tmai_core::task_meta::TaskMetaService::spawn(app.shared_state(), core.subscribe());

    // Restore in-memory issue/PR associations from persisted .task-meta/ files
    tmai_core::task_meta::restore_from_disk(&app.shared_state(), &settings.project_paths());

    // Start Codex CLI app-server WebSocket connections if configured
    if !settings.codex_ws.connections.is_empty() {
        let codex_ws_service = tmai_core::codex_ws::CodexWsService::new(
            &settings.codex_ws.connections,
            core.hook_registry().clone(),
            core.event_sender(),
            app_state.clone(),
        );
        // Capture senders for bidirectional control before start() consumes service
        let ws_sender_registry =
            tmai_core::command_sender::new_codex_ws_sender_registry(codex_ws_service.senders());
        core.set_codex_ws_senders(ws_sender_registry);
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
            .with_hook_registry(core.hook_registry().clone())
            .with_pty_registry(core.pty_registry().clone()),
            audit_tx,
        );
        service.start();
    }

    app.run().await
}

/// Run in WebUI mode (default — hooks/IPC + web server, no TUI)
async fn run_webui_mode(settings: Settings, debug: bool) -> Result<()> {
    use tmai_core::runtime::StandaloneAdapter;

    eprintln!("tmai: starting in WebUI mode (no tmux required)");

    // Create audit event channel (if audit enabled)
    let (audit_tx, audit_rx) = if settings.audit.enabled {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    // Start IPC server
    let ipc_server = IpcServer::start()
        .await
        .context("Failed to start IPC server")?;
    let ipc_server = Arc::new(ipc_server);

    // Use TmuxAdapter if tmux is available, otherwise StandaloneAdapter
    let runtime: Arc<dyn RuntimeAdapter> = if std::env::var("TMUX").is_ok() {
        eprintln!("tmai: tmux detected, using TmuxAdapter for capture-pane support");
        Arc::new(tmai_core::runtime::TmuxAdapter::new(settings.capture_lines))
    } else {
        Arc::new(StandaloneAdapter::new())
    };

    // Create shared state
    let state = tmai_core::state::AppState::shared();
    {
        let mut s = state.write();
        s.show_activity_name = settings.ui.show_activity_name;
        s.registered_projects = settings.project_paths();
        s.spawn_in_tmux = settings.spawn.use_tmux_window;
        s.spawn_tmux_window_name = settings.spawn.tmux_window_name.clone();
    }

    // Create hook registry and load token
    let hook_registry = tmai_core::hooks::new_hook_registry();

    // Create command sender (PTY session → IPC → tmux → PTY inject)
    let cmd_sender = Arc::new(
        CommandSender::new(Some(ipc_server.clone()), runtime.clone(), state.clone())
            .with_hook_registry(hook_registry.clone()),
    );
    // Note: pty_registry is attached after core is built (see below)
    let session_pane_map = tmai_core::hooks::new_session_pane_map();
    let hook_token = tmai::init::load_hook_token();

    // Create shared transcript registry (shared between Poller and TmaiCore)
    let transcript_registry = tmai_core::transcript::watcher::new_transcript_registry();

    // Build TmaiCore facade
    let mut core_builder = TmaiCoreBuilder::new(settings.clone())
        .with_state(state.clone())
        .with_ipc_server(ipc_server.clone())
        .with_command_sender(cmd_sender)
        .with_hook_registry(hook_registry.clone())
        .with_session_pane_map(session_pane_map)
        .with_transcript_registry(transcript_registry.clone())
        .with_runtime(runtime.clone());

    if let Some(token) = hook_token {
        eprintln!("tmai: hook token loaded, hook endpoint enabled");
        core_builder = core_builder.with_hook_token(token);
    } else {
        eprintln!("tmai: no hook token found — run `tmai init` to enable hooks");
    }

    if let Some(ref tx) = audit_tx {
        core_builder = core_builder.with_audit_sender(tx.clone());
    }

    let core = Arc::new(core_builder.build());

    // Auto-fetch usage stats if enabled in settings
    core.start_initial_usage_fetch();

    // Start web server (required for WebUI mode)
    if !settings.web.enabled {
        anyhow::bail!("WebUI mode requires web server to be enabled ([web] enabled = true)");
    }

    let token = tmai::web::auth::generate_token();
    {
        let mut s = state.write();
        s.init_web(token.clone(), settings.web.port);
    }

    let port = settings.web.port;
    let web_server = WebServer::new(settings.clone(), core.clone(), token.clone());
    web_server.start();

    // Write API connection info for MCP server and other external tools
    if let Err(e) = tmai::mcp::client::write_api_info(port, &token) {
        eprintln!("tmai: warning: failed to write API info: {e}");
    }

    let url = format!("http://localhost:{port}/?token={token}");
    eprintln!("tmai: web server running at {url}");

    // Open in Chrome App Mode (Windows browser via WSL interop)
    // In debug mode, enable Chrome remote debugging for DevTools MCP
    open_in_browser(&url, debug);

    // Start auto-approve service if mode is not Off
    if settings.auto_approve.effective_mode()
        != tmai_core::auto_approve::types::AutoApproveMode::Off
    {
        let service = tmai_core::auto_approve::AutoApproveService::new(
            settings.auto_approve.clone(),
            state.clone(),
            CommandSender::new(Some(ipc_server.clone()), runtime.clone(), state.clone())
                .with_hook_registry(core.hook_registry().clone())
                .with_pty_registry(core.pty_registry().clone()),
            audit_tx,
        );
        service.start();
        eprintln!(
            "tmai: auto-approve service started (mode: {:?})",
            settings.auto_approve.effective_mode()
        );
    }

    // Start orchestrator notifier service
    if settings.orchestrator.enabled {
        let notify_settings = std::sync::Arc::new(parking_lot::RwLock::new(
            settings.orchestrator.notify.clone(),
        ));
        // Store in state for hot-reload from WebUI settings API
        state.write().notify_settings = Some(notify_settings.clone());
        tmai_core::orchestrator_notify::OrchestratorNotifier::spawn(
            notify_settings,
            state.clone(),
            core.subscribe(),
            core.event_sender(),
        );
        eprintln!("tmai: orchestrator notifier service started");
    }

    // Start task metadata milestone service (records events to .task-meta/ files)
    tmai_core::task_meta::TaskMetaService::spawn(state.clone(), core.subscribe());

    // Restore in-memory issue/PR associations from persisted .task-meta/ files
    tmai_core::task_meta::restore_from_disk(&state, &settings.project_paths());

    // Start Codex CLI app-server WebSocket connections if configured
    if !settings.codex_ws.connections.is_empty() {
        let codex_ws_service = tmai_core::codex_ws::CodexWsService::new(
            &settings.codex_ws.connections,
            core.hook_registry().clone(),
            core.event_sender(),
            state.clone(),
        );
        // Capture senders for bidirectional control before start() consumes service
        let ws_sender_registry =
            tmai_core::command_sender::new_codex_ws_sender_registry(codex_ws_service.senders());
        core.set_codex_ws_senders(ws_sender_registry);
        codex_ws_service.start();
        eprintln!(
            "tmai: codex WS service started ({} connection(s))",
            settings.codex_ws.connections.len()
        );
    }

    // Reconnect to any surviving Codex app-server instances from previous tmai sessions
    tmai::web::reconnect_codex_ws(&core).await;

    eprintln!("tmai: waiting for hook events from Claude Code...");
    eprintln!("tmai: press Ctrl+C to stop");

    // Start monitoring loop (Poller with standalone runtime + shared transcript registry)
    let ipc_registry = ipc_server.registry();
    let mut poller = tmai_core::monitor::Poller::new_with_transcript_registry(
        settings.clone(),
        state.clone(),
        runtime,
        ipc_registry,
        hook_registry,
        audit_rx,
        transcript_registry,
    );
    poller = poller.with_event_tx(core.event_sender().clone());

    // Run poller in background
    let mut poll_rx = poller.start();

    // Background task: deliver queued prompts when agents become idle
    {
        let core = core.clone();
        let mut event_rx = core.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = event_rx.recv().await {
                if let tmai_core::api::CoreEvent::PromptReady { target, prompt } = event {
                    tracing::info!("Delivering queued prompt to agent {}", target);
                    if let Err(e) = core.send_text(&target, &prompt).await {
                        tracing::warn!("Failed to deliver queued prompt to {}: {}", target, e);
                    }
                }
            }
        });
    }

    // Start PR/CI monitor if orchestrator.pr_monitor_enabled
    {
        let orch_settings = settings.resolve_orchestrator(None);
        if orch_settings.pr_monitor_enabled {
            let project_paths = settings.project_paths();
            if project_paths.is_empty() {
                tracing::info!("PR monitor enabled but no projects registered, skipping");
            } else {
                for path in &project_paths {
                    let project_orch = settings.resolve_orchestrator(Some(path));
                    if project_orch.pr_monitor_enabled {
                        tracing::info!("Starting PR monitor for project: {}", path);
                        #[allow(deprecated)]
                        let shared_state = core.raw_state().clone();
                        tmai_core::github::pr_monitor::spawn_pr_monitor(
                            path.clone(),
                            core.event_sender().clone(),
                            project_orch.clone(),
                            Some(shared_state),
                        );
                    }
                }
            }
        }
    }

    // Interval for syncing PTY session liveness with agent status
    let mut pty_sync_interval = tokio::time::interval(std::time::Duration::from_secs(2));
    pty_sync_interval.tick().await; // skip first tick

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
            _ = pty_sync_interval.tick() => {
                if core.sync_pty_sessions() {
                    core.notify_agents_updated();
                }
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\ntmai: shutting down...");
                break;
            }
        }
    }

    // Cleanup API connection info
    tmai::mcp::client::remove_api_info();

    Ok(())
}

/// Chrome remote debugging port for DevTools MCP connection
const CHROME_DEBUG_PORT: u16 = 9222;

/// Open URL in browser, preferring Chrome App Mode for standalone window experience.
///
/// Tries chrome/chromium --app= first (standalone window, no tabs/address bar),
/// then falls back to xdg-open. On WSL2, uses Windows browser via interop.
///
/// When `debug` is true, launches Chrome as a separate process with
/// `--remote-debugging-port=9222` and a dedicated user-data-dir so that
/// Chrome DevTools MCP can connect even when Chrome is already running.
fn open_in_browser(url: &str, debug: bool) {
    use std::process::Command;

    /// Chrome executable paths to try
    struct ChromeCandidate {
        path: &'static str,
        is_windows: bool,
    }

    let candidates = [
        ChromeCandidate {
            path: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
            is_windows: true,
        },
        ChromeCandidate {
            path: "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
            is_windows: true,
        },
        ChromeCandidate {
            path: "google-chrome",
            is_windows: false,
        },
        ChromeCandidate {
            path: "google-chrome-stable",
            is_windows: false,
        },
        ChromeCandidate {
            path: "chromium",
            is_windows: false,
        },
        ChromeCandidate {
            path: "chromium-browser",
            is_windows: false,
        },
    ];

    for candidate in &candidates {
        let mut cmd = Command::new(candidate.path);
        cmd.arg(format!("--app={url}"));

        if debug {
            cmd.arg(format!("--remote-debugging-port={CHROME_DEBUG_PORT}"));
            // Use a dedicated profile so Chrome starts as a new process
            // (existing Chrome ignores --remote-debugging-port)
            // Windows Chrome needs a Windows path; Linux Chrome uses a Linux path
            let user_data_dir = if candidate.is_windows {
                r"C:\Temp\tmai-chrome-debug".to_string()
            } else {
                "/tmp/tmai-chrome-debug".to_string()
            };
            cmd.arg(format!("--user-data-dir={user_data_dir}"));
        }

        if cmd.spawn().is_ok() {
            eprintln!("tmai: opened in Chrome App Mode");
            if debug {
                eprintln!("tmai: Chrome DevTools Protocol on port {CHROME_DEBUG_PORT} (for MCP)");
            }
            return;
        }
    }

    // Fallback: xdg-open (opens default browser with full UI)
    if Command::new("xdg-open").arg(url).spawn().is_ok() {
        eprintln!("tmai: opened in default browser");
        return;
    }

    eprintln!("tmai: could not open browser automatically — open the URL manually");
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

/// Run inter-agent CLI commands (agents/output/send).
///
/// These commands use TMAI_API_URL and TMAI_TOKEN environment variables
/// to call the tmai web API, allowing spawned agents to communicate.
fn run_agent_command(cmd: tmai_core::config::Command) -> Result<()> {
    use tmai_core::config::Command;

    let api_url =
        std::env::var("TMAI_API_URL").unwrap_or_else(|_| "http://127.0.0.1:9876".to_string());
    let token = std::env::var("TMAI_TOKEN").unwrap_or_default();

    let auth_header = format!("Bearer {}", token);

    match cmd {
        Command::Agents => {
            let url = format!("{}/api/agents", api_url);
            let mut resp = ureq::get(&url)
                .header("Authorization", &auth_header)
                .call()
                .context("Failed to fetch agents")?;
            let body: serde_json::Value = resp
                .body_mut()
                .read_json()
                .context("Failed to parse JSON")?;

            if let Some(agents) = body.as_array() {
                for agent in agents {
                    let id = agent["id"].as_str().unwrap_or("?");
                    let agent_type = agent["agent_type"].as_str().unwrap_or("?");
                    let status_type = agent["status"]["type"].as_str().unwrap_or("?");
                    let cwd = agent["cwd"].as_str().unwrap_or("?");
                    let pty = if agent["pty_session_id"].is_string() {
                        " [pty]"
                    } else {
                        ""
                    };
                    println!("{}\t{}\t{}\t{}{}", id, agent_type, status_type, cwd, pty);
                }
            }
        }
        Command::Output { id } => {
            let url = format!("{}/api/agents/{}/output", api_url, urlencoded(&id));
            let resp = ureq::get(&url).header("Authorization", &auth_header).call();
            match resp {
                Ok(mut r) => {
                    let body: serde_json::Value =
                        r.body_mut().read_json().context("Failed to parse JSON")?;
                    if let Some(output) = body["output"].as_str() {
                        print!("{}", output);
                    }
                }
                Err(ureq::Error::StatusCode(404)) => {
                    // Not a PTY session — try the preview endpoint
                    let preview_url = format!("{}/api/agents/{}/preview", api_url, urlencoded(&id));
                    let mut resp = ureq::get(&preview_url)
                        .header("Authorization", &auth_header)
                        .call()
                        .context("Failed to fetch preview")?;
                    let body: serde_json::Value = resp
                        .body_mut()
                        .read_json()
                        .context("Failed to parse JSON")?;
                    if let Some(content) = body["content"].as_str() {
                        print!("{}", content);
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        Command::Send { id, text } => {
            let message = text.join(" ");
            if message.is_empty() {
                anyhow::bail!("No text to send. Usage: tmai send <id> <text...>");
            }

            // Use send-to endpoint with self as source (session_id from env)
            let self_id = std::env::var("TMAI_SESSION_ID").unwrap_or_else(|_| "cli".to_string());
            let url = format!(
                "{}/api/agents/{}/send-to/{}",
                api_url,
                urlencoded(&self_id),
                urlencoded(&id)
            );
            let mut resp = ureq::post(&url)
                .header("Authorization", &auth_header)
                .header("Content-Type", "application/json")
                .send(serde_json::json!({"text": message}).to_string().as_bytes())
                .context("Failed to send text")?;
            let body: serde_json::Value = resp
                .body_mut()
                .read_json()
                .context("Failed to parse response")?;
            if body["status"].as_str() == Some("ok") {
                eprintln!("Sent to {}", id);
            } else {
                eprintln!("Send failed: {}", body);
            }
        }
        _ => unreachable!(),
    }

    Ok(())
}

/// Simple percent-encoding for URL path segments
fn urlencoded(s: &str) -> String {
    s.replace('%', "%25")
        .replace('/', "%2F")
        .replace(':', "%3A")
        .replace(' ', "%20")
}
