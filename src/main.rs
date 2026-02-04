use anyhow::Result;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai::config::{Config, Settings};
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

    // Setup logging
    setup_logging(cli.debug);

    // Check for wrap subcommand
    if cli.is_wrap_mode() {
        return run_wrap_mode(&cli);
    }

    // Load settings
    let mut settings = Settings::load(cli.config.as_ref())?;
    settings.merge_cli(&cli);
    settings.validate();

    // Run the application with web server
    let mut app = App::new(settings.clone());

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
        let web_server = WebServer::new(settings.clone(), state, token);
        web_server.start();
    }

    app.run().await
}

/// Run in wrap mode (PTY proxy for AI agent)
fn run_wrap_mode(cli: &Config) -> Result<()> {
    let (command, args) = cli.get_wrap_args().ok_or_else(|| {
        anyhow::anyhow!("No command specified for wrap mode. Usage: tmai wrap <command> [args...]")
    })?;

    tracing::info!("Wrapping command: {} {:?}", command, args);

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

fn setup_logging(debug: bool) {
    let filter = if debug {
        EnvFilter::new("tmai=debug")
    } else {
        EnvFilter::new("tmai=info")
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();
}
