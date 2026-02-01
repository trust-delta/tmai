use anyhow::Result;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use tmai::config::{Config, Settings};
use tmai::ui::App;
use tmai::web::WebServer;

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
