use anyhow::{bail, Context, Result};
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai_ratatui::api::{self, ApiClient};

#[derive(Debug, Parser)]
#[command(
    name = "tmai-ratatui",
    version,
    about = "Terminal UI for tmai-core — speaks HTTP + SSE via tmai-api-spec"
)]
struct Cli {
    /// Base URL of a running tmai-core (e.g. http://127.0.0.1:9876).
    /// When omitted, the CLI reads $XDG_RUNTIME_DIR/tmai/api.json.
    #[arg(long)]
    url: Option<String>,

    /// Bearer token. Used with --url; ignored when api.json is read.
    #[arg(long)]
    token: Option<String>,

    /// Write verbose logs to `tmai-ratatui.log` in the current directory.
    #[arg(long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    setup_logging(cli.debug)?;

    let (base, token) = match (cli.url, cli.token) {
        (Some(url), Some(tok)) => (url, tok),
        (Some(url), None) => {
            let info = api::load_connection_info().context(
                "--url given without --token, and $XDG_RUNTIME_DIR/tmai/api.json not readable",
            )?;
            (url, info.token)
        }
        (None, _) => {
            let info = api::load_connection_info()
                .context("failed to discover tmai-core — is it running?")?;
            (format!("http://127.0.0.1:{}", info.port), info.token)
        }
    };

    if token.is_empty() {
        bail!("empty bearer token");
    }

    let client = ApiClient::new(base, token);
    tmai_ratatui::ui::run(client).await
}

fn setup_logging(debug: bool) -> Result<()> {
    if !debug {
        return Ok(());
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("tmai-ratatui.log")
        .context("open log file")?;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(file)
                .with_ansi(false),
        )
        .try_init()
        .ok();
    Ok(())
}
