//! Event loop: dispatches terminal input to the API client and SSE
//! events to the list view.

use std::io::Stdout;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture, Event, EventStream, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use futures_util::StreamExt;
use ratatui::{backend::CrosstermBackend, Terminal};
use tokio::sync::mpsc;

use crate::api::ApiClient;
use crate::events::{self, AppEvent};
use crate::types::Agent;
use crate::ui::session_list::{render, InputModeView, SessionListView};

#[derive(Debug, Clone)]
pub enum InputMode {
    Normal,
    SendText(String),
    ConfirmKill(String), // agent id
}

struct AppState {
    agents: Vec<Agent>,
    selected: usize,
    input_mode: InputMode,
    status_line: String,
}

impl AppState {
    fn new() -> Self {
        Self {
            agents: Vec::new(),
            selected: 0,
            input_mode: InputMode::Normal,
            status_line: "connecting…".into(),
        }
    }

    fn clamp(&mut self) {
        if self.agents.is_empty() {
            self.selected = 0;
        } else if self.selected >= self.agents.len() {
            self.selected = self.agents.len() - 1;
        }
    }

    fn current(&self) -> Option<&Agent> {
        self.agents.get(self.selected)
    }
}

pub async fn run(client: ApiClient) -> Result<()> {
    let mut state = AppState::new();

    // Backfill initial snapshot.
    match events::backfill(&client).await {
        Ok(agents) => {
            state.agents = agents;
            state.status_line = format!("connected to {}", client.base_url());
        }
        Err(e) => {
            state.status_line = format!("backfill failed: {e}");
        }
    }

    let (ev_tx, mut ev_rx) = mpsc::unbounded_channel::<AppEvent>();
    events::spawn(client.clone(), ev_tx);

    let mut terminal = setup_terminal()?;
    let mut keys = EventStream::new();

    let result = event_loop(&mut terminal, &client, &mut state, &mut keys, &mut ev_rx).await;
    teardown_terminal(&mut terminal)?;
    result
}

async fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    client: &ApiClient,
    state: &mut AppState,
    keys: &mut EventStream,
    ev_rx: &mut mpsc::UnboundedReceiver<AppEvent>,
) -> Result<()> {
    let mut tick = tokio::time::interval(Duration::from_millis(250));

    loop {
        draw(terminal, state)?;

        tokio::select! {
            key_event = keys.next() => {
                match key_event {
                    Some(Ok(Event::Key(key))) => {
                        if handle_key(state, client, key).await? {
                            return Ok(());
                        }
                    }
                    Some(Err(e)) => {
                        state.status_line = format!("terminal error: {e}");
                    }
                    None => return Ok(()),
                    _ => {}
                }
            }
            app_event = ev_rx.recv() => {
                match app_event {
                    Some(AppEvent::Agents(list)) => {
                        state.agents = list;
                        state.clamp();
                    }
                    Some(AppEvent::Reconnected) => {
                        state.status_line = format!("SSE connected to {}", client.base_url());
                        // Refetch snapshot after reconnect.
                        if let Ok(list) = events::backfill(client).await {
                            state.agents = list;
                            state.clamp();
                        }
                    }
                    Some(AppEvent::Disconnected(err)) => {
                        state.status_line = format!("SSE disconnected: {err}");
                    }
                    None => {}
                }
            }
            _ = tick.tick() => {}
        }
    }
}

async fn handle_key(
    state: &mut AppState,
    client: &ApiClient,
    key: crossterm::event::KeyEvent,
) -> Result<bool> {
    // Ctrl+C is a global exit regardless of mode.
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        return Ok(true);
    }

    // Clone out the mode; each handler either reinstalls a new mode or
    // pushes back the (possibly mutated) original.
    let mode = std::mem::replace(&mut state.input_mode, InputMode::Normal);
    match mode {
        InputMode::Normal => handle_normal(state, client, key).await,
        InputMode::SendText(buffer) => handle_send_text(state, client, key, buffer).await,
        InputMode::ConfirmKill(id) => handle_confirm_kill(state, client, key, id).await,
    }
}

async fn handle_normal(
    state: &mut AppState,
    client: &ApiClient,
    key: crossterm::event::KeyEvent,
) -> Result<bool> {
    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => return Ok(true),
        KeyCode::Char('j') | KeyCode::Down => {
            if !state.agents.is_empty() {
                state.selected = (state.selected + 1) % state.agents.len();
            }
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if !state.agents.is_empty() {
                state.selected = if state.selected == 0 {
                    state.agents.len() - 1
                } else {
                    state.selected - 1
                };
            }
        }
        KeyCode::Char('a') => {
            if let Some(agent) = state.current() {
                let id = agent.id.clone();
                match client.approve(&id).await {
                    Ok(()) => state.status_line = format!("approved {id}"),
                    Err(e) => state.status_line = format!("approve {id}: {e}"),
                }
            }
        }
        KeyCode::Char('y') => {
            if let Some(agent) = state.current() {
                let id = agent.id.clone();
                match client.send_key(&id, "y").await {
                    Ok(()) => state.status_line = format!("sent 'y' to {id}"),
                    Err(e) => state.status_line = format!("send_key {id}: {e}"),
                }
            }
        }
        KeyCode::Char('n') => {
            if let Some(agent) = state.current() {
                let id = agent.id.clone();
                match client.send_key(&id, "n").await {
                    Ok(()) => state.status_line = format!("sent 'n' to {id}"),
                    Err(e) => state.status_line = format!("send_key {id}: {e}"),
                }
            }
        }
        KeyCode::Char('i') => {
            state.input_mode = InputMode::SendText(String::new());
        }
        KeyCode::Char('K') => {
            if let Some(agent) = state.current() {
                state.input_mode = InputMode::ConfirmKill(agent.id.clone());
            }
        }
        KeyCode::Char('r') => match events::backfill(client).await {
            Ok(list) => {
                state.agents = list;
                state.clamp();
                state.status_line = "refreshed".into();
            }
            Err(e) => state.status_line = format!("refresh: {e}"),
        },
        _ => {}
    }
    Ok(false)
}

async fn handle_send_text(
    state: &mut AppState,
    client: &ApiClient,
    key: crossterm::event::KeyEvent,
    mut buffer: String,
) -> Result<bool> {
    match key.code {
        KeyCode::Esc => {
            state.input_mode = InputMode::Normal;
        }
        KeyCode::Enter => {
            state.input_mode = InputMode::Normal;
            if let Some(agent) = state.current() {
                let id = agent.id.clone();
                match client.send_text(&id, &buffer).await {
                    Ok(()) => state.status_line = format!("sent text to {id}"),
                    Err(e) => state.status_line = format!("send_text {id}: {e}"),
                }
            }
        }
        KeyCode::Backspace => {
            buffer.pop();
            state.input_mode = InputMode::SendText(buffer);
        }
        KeyCode::Char(c) => {
            buffer.push(c);
            state.input_mode = InputMode::SendText(buffer);
        }
        _ => {
            // keep the buffer — user hit a non-printable we don't handle
            state.input_mode = InputMode::SendText(buffer);
        }
    }
    Ok(false)
}

async fn handle_confirm_kill(
    state: &mut AppState,
    client: &ApiClient,
    key: crossterm::event::KeyEvent,
    id: String,
) -> Result<bool> {
    match key.code {
        KeyCode::Char('y') | KeyCode::Enter => {
            state.input_mode = InputMode::Normal;
            match client.kill(&id).await {
                Ok(()) => state.status_line = format!("killed {id}"),
                Err(e) => state.status_line = format!("kill {id}: {e}"),
            }
        }
        KeyCode::Char('n') | KeyCode::Esc => {
            state.input_mode = InputMode::Normal;
        }
        _ => {
            // keep waiting for y/n
            state.input_mode = InputMode::ConfirmKill(id);
        }
    }
    Ok(false)
}

fn draw(terminal: &mut Terminal<CrosstermBackend<Stdout>>, state: &AppState) -> Result<()> {
    let kill_prompt = if let InputMode::ConfirmKill(id) = &state.input_mode {
        format!("kill agent {id}? (y/n)")
    } else {
        String::new()
    };
    terminal.draw(|frame| {
        let area = frame.area();
        let input_mode_view = match &state.input_mode {
            InputMode::Normal => InputModeView::Normal,
            InputMode::SendText(buffer) => InputModeView::Text { buffer },
            InputMode::ConfirmKill(_) => InputModeView::Confirm {
                prompt: &kill_prompt,
            },
        };
        let view = SessionListView {
            agents: &state.agents,
            selected: state.selected,
            input_mode: input_mode_view,
            status_line: &state.status_line,
        };
        render(frame, area, view);
    })?;
    Ok(())
}

fn setup_terminal() -> Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend)?;
    Ok(terminal)
}

fn teardown_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}
