use anyhow::Result;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai::config::{Config, Settings};
use tmai::ui::App;

#[tokio::main]
async fn main() -> Result<()> {
    // Parse CLI arguments
    let cli = Config::parse_args();

    // Setup logging
    setup_logging(cli.debug);

    // Load settings
    let mut settings = Settings::load(cli.config.as_ref())?;
    settings.merge_cli(&cli);
    settings.validate();

    // Run the application
    let mut app = App::new(settings);
    app.run().await
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
