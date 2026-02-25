use parking_lot::RwLock;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::agents::MonitoredAgent;
use crate::config::CreateProcessSettings;
use crate::teams::{AgentDefinition, TeamConfig, TeamTask};
use crate::tmux::PaneInfo;
use crate::usage::UsageSnapshot;

/// Shared state type alias
pub type SharedState = Arc<RwLock<AppState>>;

/// Input mode for the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InputMode {
    /// Normal navigation mode
    #[default]
    Normal,
    /// Text input mode
    Input,
    /// Passthrough mode - keys are sent directly to the target pane
    Passthrough,
}

/// Sort method for agent list
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortBy {
    /// Sort by working directory (default)
    #[default]
    Directory,
    /// Default order (session:window.pane)
    SessionOrder,
    /// Sort by agent type
    AgentType,
    /// Sort by status (attention needed first)
    Status,
    /// Sort by last update time
    LastUpdate,
    /// Sort by team
    Team,
    /// Sort by git repository (groups main + worktrees together)
    Repository,
}

impl SortBy {
    /// Get the next sort method in cycle
    pub fn next(self) -> Self {
        match self {
            SortBy::Directory => SortBy::SessionOrder,
            SortBy::SessionOrder => SortBy::AgentType,
            SortBy::AgentType => SortBy::Status,
            SortBy::Status => SortBy::LastUpdate,
            SortBy::LastUpdate => SortBy::Team,
            SortBy::Team => SortBy::Repository,
            SortBy::Repository => SortBy::Directory,
        }
    }

    /// Get display name for the sort method
    pub fn display_name(&self) -> &'static str {
        match self {
            SortBy::Directory => "Directory",
            SortBy::SessionOrder => "Session",
            SortBy::AgentType => "Type",
            SortBy::Status => "Status",
            SortBy::LastUpdate => "Updated",
            SortBy::Team => "Team",
            SortBy::Repository => "Repository",
        }
    }
}

/// Monitor scope for filtering panes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MonitorScope {
    /// Monitor all attached sessions
    #[default]
    AllSessions,
    /// Monitor current session only
    CurrentSession,
    /// Monitor current window only
    CurrentWindow,
}

impl MonitorScope {
    /// Get the next scope in cycle
    pub fn next(self) -> Self {
        match self {
            MonitorScope::AllSessions => MonitorScope::CurrentSession,
            MonitorScope::CurrentSession => MonitorScope::CurrentWindow,
            MonitorScope::CurrentWindow => MonitorScope::AllSessions,
        }
    }

    /// Get display name for the scope
    pub fn display_name(&self) -> &'static str {
        match self {
            MonitorScope::AllSessions => "All",
            MonitorScope::CurrentSession => "Session",
            MonitorScope::CurrentWindow => "Window",
        }
    }
}

/// Spinner frames for processing animation
pub const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Marquee scroll interval in milliseconds
const MARQUEE_INTERVAL_MS: u64 = 280;

/// State for marquee text scrolling animation
#[derive(Debug, Clone)]
pub struct MarqueeState {
    /// Current scroll offset (in characters)
    pub offset: usize,
    /// Last update timestamp
    pub last_update: std::time::Instant,
    /// ID of the selected item (to detect selection change)
    pub selected_id: Option<String>,
}

impl Default for MarqueeState {
    fn default() -> Self {
        Self {
            offset: 0,
            last_update: std::time::Instant::now(),
            selected_id: None,
        }
    }
}

/// Placement type for creating new AI process
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlacementType {
    /// Create a new tmux session + window
    NewSession,
    /// Create a new window in existing session
    NewWindow,
    /// Split existing window to add a pane
    SplitPane,
}

/// Tree entry for the tree-style target selection UI
#[derive(Debug, Clone)]
pub enum TreeEntry {
    /// Create a new session
    NewSession,
    /// Session node (collapsible)
    Session { name: String, collapsed: bool },
    /// Create a new window in a session
    NewWindow { session: String },
    /// Window node (collapsible)
    Window {
        session: String,
        index: u32,
        name: String,
        collapsed: bool,
    },
    /// Split a pane
    SplitPane { target: String },
}

/// Action to confirm before executing
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfirmAction {
    /// Kill a tmux pane
    KillPane { target: String },
    /// Restart a non-IPC agent as PTY-wrapped (session ID already known)
    RestartAsWrapped { target: String, session_id: String },
    /// Send a probe marker to identify session, then restart as wrapped
    ProbeAndRestartAsWrapped { target: String, cwd: String },
}

/// State for confirmation dialog
#[derive(Debug, Clone)]
pub struct ConfirmationState {
    /// Action to execute on confirmation
    pub action: ConfirmAction,
    /// Message to display
    pub message: String,
}

/// An item in the directory selection list
#[derive(Debug, Clone)]
pub enum DirItem {
    /// Section header (not selectable, cursor skips)
    Header(String),
    /// "Enter path..." action
    EnterPath,
    /// Home directory
    Home,
    /// Current directory
    Current,
    /// A selectable directory with display name and full path
    Directory { display: String, path: String },
}

impl DirItem {
    /// Whether this item is selectable (non-header)
    pub fn is_selectable(&self) -> bool {
        !matches!(self, DirItem::Header(_))
    }
}

/// Step in the create process flow
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateProcessStep {
    /// Select target from tree (combined placement + target selection)
    SelectTarget,
    /// Select directory
    SelectDirectory,
    /// Select AI agent type
    SelectAgent,
}

/// State for the create process flow
#[derive(Debug, Clone)]
pub struct CreateProcessState {
    /// Current step in the flow
    pub step: CreateProcessStep,
    /// Selected placement type
    pub placement_type: Option<PlacementType>,
    /// Group key that initiated the flow (directory path or session name)
    pub origin_group_key: String,
    /// Selected tmux session name (for NewWindow)
    pub target_session: Option<String>,
    /// Target pane to split (for SplitPane, session:window.pane format)
    pub target_pane: Option<String>,
    /// Selected directory path
    pub directory: Option<String>,
    /// Cursor position in the popup list
    pub cursor: usize,
    /// Input buffer for directory path entry
    pub input_buffer: String,
    /// Available panes list (cached)
    pub available_panes: Vec<PaneInfo>,
    /// Collapsed node keys (session name or "session:window_index")
    pub collapsed_nodes: HashSet<String>,
    /// Tree entries (cached, rebuilt when collapsed_nodes changes)
    pub tree_entries: Vec<TreeEntry>,
    /// Directory selection items (includes headers, pinned, base, known)
    pub directory_items: Vec<DirItem>,
    /// Whether in path input mode
    pub is_input_mode: bool,
}

/// Snapshot of a team's state at a point in time
#[derive(Debug, Clone)]
pub struct TeamSnapshot {
    /// Team configuration
    pub config: TeamConfig,
    /// Current tasks
    pub tasks: Vec<TeamTask>,
    /// Mapping of member_name → pane target
    pub member_panes: HashMap<String, String>,
    /// When this snapshot was last updated
    pub last_scan: chrono::DateTime<chrono::Utc>,
    /// Pre-computed completed task count
    pub task_done: usize,
    /// Pre-computed total task count
    pub task_total: usize,
    /// Pre-computed in-progress task count
    pub task_in_progress: usize,
    /// Pre-computed pending task count
    pub task_pending: usize,
    /// Worktree names used by this team's members
    pub worktree_names: Vec<String>,
}

/// Input-related state
#[derive(Debug, Default)]
pub struct InputState {
    /// Current input mode
    pub mode: InputMode,
    /// Input buffer for text entry
    pub buffer: String,
    /// Cursor position in input buffer (byte offset)
    pub cursor_position: usize,
}

/// UI view state (overlays, scroll, animations)
#[derive(Debug)]
pub struct ViewState {
    /// Whether help screen is shown
    pub show_help: bool,
    /// Help screen scroll offset
    pub help_scroll: u16,
    /// Whether QR code screen is shown
    pub show_qr: bool,
    /// Whether the team overview screen is shown
    pub show_team_overview: bool,
    /// Whether the task overlay is shown
    pub show_task_overlay: bool,
    /// Task overlay scroll offset
    pub task_overlay_scroll: u16,
    /// Team overview scroll offset
    pub team_overview_scroll: u16,
    /// Preview scroll offset
    pub preview_scroll: u16,
    /// Spinner animation frame counter
    pub spinner_frame: usize,
    /// Last spinner update time
    pub last_spinner_update: std::time::Instant,
    /// Marquee animation state for selected item
    pub marquee_state: MarqueeState,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            show_help: false,
            help_scroll: 0,
            show_qr: false,
            show_team_overview: false,
            show_task_overlay: false,
            task_overlay_scroll: 0,
            team_overview_scroll: 0,
            preview_scroll: 0,
            spinner_frame: 0,
            last_spinner_update: std::time::Instant::now(),
            marquee_state: MarqueeState::default(),
        }
    }
}

/// Selection/navigation state
#[derive(Debug, Default)]
pub struct SelectionState {
    /// Currently selected agent index
    pub selected_index: usize,
    /// Selected entry index (for UI navigation including CreateNew entries)
    pub selected_entry_index: usize,
    /// Total selectable entries count (cached)
    pub selectable_count: usize,
    /// Whether CreateNew entry is currently selected
    pub is_on_create_new: bool,
    /// Collapsed group keys (for group header folding)
    pub collapsed_groups: HashSet<String>,
}

/// Web-related state
#[derive(Debug, Default)]
pub struct WebState {
    /// Web server authentication token
    pub token: Option<String>,
    /// Web server port
    pub port: u16,
}

/// Application state
#[derive(Debug)]
pub struct AppState {
    // Sub-states
    /// Input-related state
    pub input: InputState,
    /// UI view state (overlays, scroll, animations)
    pub view: ViewState,
    /// Selection/navigation state
    pub selection: SelectionState,
    /// Web-related state
    pub web: WebState,

    // Core domain (unchanged)
    /// All monitored agents by target ID
    pub agents: HashMap<String, MonitoredAgent>,
    /// Order of agents for display
    pub agent_order: Vec<String>,
    /// Current sort method
    pub sort_by: SortBy,
    /// Monitor scope for filtering panes
    pub monitor_scope: MonitorScope,
    /// Current session name (for scope display)
    pub current_session: Option<String>,
    /// Current window index (for scope display)
    pub current_window: Option<u32>,
    /// Team snapshots by team name
    pub teams: HashMap<String, TeamSnapshot>,
    /// Agent definitions from `.claude/agents/*.md`
    #[allow(dead_code)]
    pub agent_definitions: Vec<AgentDefinition>,
    /// Mapping of tmux target (e.g. "main:0.1") to pane_id (e.g. "5") for IPC
    pub target_to_pane_id: HashMap<String, String>,

    // Dialog/mode state (unchanged)
    /// Create process flow state (None if not in create mode)
    pub create_process: Option<CreateProcessState>,
    /// Confirmation dialog state (None if not showing)
    pub confirmation_state: Option<ConfirmationState>,
    /// Error message to display
    pub error_message: Option<String>,
    /// Last poll timestamp
    pub last_poll: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether the app is running
    pub running: bool,

    /// Show activity name (tool/verb) during Processing instead of generic "Processing"
    pub show_activity_name: bool,

    /// Temporary notification message (auto-expires)
    pub notification: Option<(String, std::time::Instant)>,

    /// Claude Code subscription usage snapshot
    pub usage: UsageSnapshot,
}

impl AppState {
    /// Create a new application state
    pub fn new() -> Self {
        Self {
            input: InputState::default(),
            view: ViewState::default(),
            selection: SelectionState::default(),
            web: WebState {
                token: None,
                port: 9876,
            },
            agents: HashMap::new(),
            agent_order: Vec::new(),
            sort_by: SortBy::Directory,
            monitor_scope: MonitorScope::default(),
            current_session: None,
            current_window: None,
            teams: HashMap::new(),
            agent_definitions: Vec::new(),
            target_to_pane_id: HashMap::new(),
            create_process: None,
            confirmation_state: None,
            error_message: None,
            last_poll: None,
            running: true,
            show_activity_name: true,
            notification: None,
            usage: UsageSnapshot::default(),
        }
    }

    /// Advance the spinner animation frame (time-based, ~150ms per frame)
    pub fn tick_spinner(&mut self) {
        let elapsed = self.view.last_spinner_update.elapsed();
        if elapsed.as_millis() >= 150 {
            self.view.last_spinner_update = std::time::Instant::now();
            self.view.spinner_frame = (self.view.spinner_frame + 1) % SPINNER_FRAMES.len();
        }
    }

    /// Get the current spinner character
    pub fn spinner_char(&self) -> char {
        SPINNER_FRAMES[self.view.spinner_frame]
    }

    /// Advance the marquee scroll offset (time-based)
    pub fn tick_marquee(&mut self) {
        let elapsed = self.view.marquee_state.last_update.elapsed();
        if elapsed.as_millis() >= MARQUEE_INTERVAL_MS as u128 {
            self.view.marquee_state.last_update = std::time::Instant::now();
            self.view.marquee_state.offset += 1;
        }
    }

    /// Reset marquee state when selection changes
    pub fn reset_marquee(&mut self, new_id: Option<String>) {
        if self.view.marquee_state.selected_id != new_id {
            self.view.marquee_state.offset = 0;
            self.view.marquee_state.selected_id = new_id;
            self.view.marquee_state.last_update = std::time::Instant::now();
        }
    }

    /// Get the current marquee scroll offset
    pub fn marquee_offset(&self) -> usize {
        self.view.marquee_state.offset
    }

    /// Create a shared state
    pub fn shared() -> SharedState {
        Arc::new(RwLock::new(Self::new()))
    }

    /// Set a temporary notification message (auto-expires after 3 seconds)
    pub fn set_notification(&mut self, message: String) {
        self.notification = Some((message, std::time::Instant::now()));
    }

    /// Get the current notification message if it hasn't expired (3 second TTL)
    pub fn active_notification(&self) -> Option<&str> {
        self.notification.as_ref().and_then(|(msg, ts)| {
            if ts.elapsed().as_secs() < 3 {
                Some(msg.as_str())
            } else {
                None
            }
        })
    }

    /// Get the currently selected agent
    pub fn selected_agent(&self) -> Option<&MonitoredAgent> {
        self.agent_order
            .get(self.selection.selected_index)
            .and_then(|id| self.agents.get(id))
    }

    /// Get a mutable reference to the selected agent
    pub fn selected_agent_mut(&mut self) -> Option<&mut MonitoredAgent> {
        if let Some(id) = self.agent_order.get(self.selection.selected_index).cloned() {
            self.agents.get_mut(&id)
        } else {
            None
        }
    }

    /// Get the selected agent's target ID
    pub fn selected_target(&self) -> Option<&str> {
        self.agent_order
            .get(self.selection.selected_index)
            .map(|s| s.as_str())
    }

    /// Update agents from a new list
    pub fn update_agents(&mut self, agents: Vec<MonitoredAgent>) {
        // Use HashSet for O(1) lookup instead of Vec::contains O(n)
        let new_ids: HashSet<String> = agents.iter().map(|a| a.id.clone()).collect();
        // Also collect as Vec for agent_order (preserves input order)
        let new_order: Vec<String> = agents.iter().map(|a| a.id.clone()).collect();

        // Remove agents that no longer exist (O(n) instead of O(n²))
        self.agents.retain(|id, _| new_ids.contains(id));

        // Update or add new agents
        for agent in agents {
            let id = agent.id.clone();
            if let Some(existing) = self.agents.get_mut(&id) {
                // Update status and content
                existing.status = agent.status;
                existing.last_content = agent.last_content;
                existing.last_content_ansi = agent.last_content_ansi;
                existing.title = agent.title;
                existing.last_update = agent.last_update;
                existing.context_warning = agent.context_warning;
                // Update meta information
                existing.cwd = agent.cwd;
                existing.pid = agent.pid;
                existing.session = agent.session;
                existing.window_name = agent.window_name;
                existing.window_index = agent.window_index;
                existing.pane_index = agent.pane_index;
                existing.team_info = agent.team_info;
                existing.is_virtual = agent.is_virtual;
                existing.detection_source = agent.detection_source;
                // Git info (set by poller's update_git_info / apply_cached_git_info)
                existing.git_branch = agent.git_branch;
                existing.git_dirty = agent.git_dirty;
                existing.is_worktree = agent.is_worktree;
                existing.git_common_dir = agent.git_common_dir;
                existing.worktree_name = agent.worktree_name;
                // Preserve auto_approve_phase from service, but clear it when
                // agent is no longer awaiting approval (state has transitioned)
                if !matches!(
                    existing.status,
                    crate::agents::AgentStatus::AwaitingApproval { .. }
                ) {
                    existing.auto_approve_phase = None;
                }
            } else {
                self.agents.insert(id.clone(), agent);
            }
        }

        // Update order, preserving selection if possible
        let old_selected = self.selected_target().map(|s| s.to_string());
        self.agent_order = new_order;

        // Apply current sort
        self.sort_agents();

        // Try to preserve selection
        if let Some(old_id) = old_selected {
            if let Some(new_index) = self.agent_order.iter().position(|id| id == &old_id) {
                self.selection.selected_index = new_index;
            }
        }

        // Ensure selection is valid
        if self.selection.selected_index >= self.agent_order.len() && !self.agent_order.is_empty() {
            self.selection.selected_index = self.agent_order.len() - 1;
        }

        self.last_poll = Some(chrono::Utc::now());
    }

    /// Cycle through sort methods
    pub fn cycle_sort(&mut self) {
        self.sort_by = self.sort_by.next();
        self.sort_agents();
    }

    /// Cycle through monitor scopes
    pub fn cycle_monitor_scope(&mut self) {
        self.monitor_scope = self.monitor_scope.next();
    }

    /// Sort agent_order based on current sort_by setting
    fn sort_agents(&mut self) {
        let agents = &self.agents;
        self.agent_order.sort_by(|a, b| {
            let agent_a = agents.get(a);
            let agent_b = agents.get(b);

            match (agent_a, agent_b) {
                (Some(a), Some(b)) => match self.sort_by {
                    SortBy::Directory => {
                        // Sort by cwd, then by id
                        a.cwd.cmp(&b.cwd).then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::SessionOrder => {
                        // session:window.pane order
                        a.id.cmp(&b.id)
                    }
                    SortBy::AgentType => {
                        // Sort by agent type name, then by id
                        a.agent_type
                            .short_name()
                            .cmp(b.agent_type.short_name())
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::Status => {
                        // Sort by status priority (attention needed first)
                        let priority_a = Self::status_priority(&a.status);
                        let priority_b = Self::status_priority(&b.status);
                        priority_a.cmp(&priority_b).then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::LastUpdate => {
                        // Sort by last update (most recent first)
                        b.last_update
                            .cmp(&a.last_update)
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::Team => {
                        // Sort by team name (no-team agents last), then by member name
                        let team_a = a
                            .team_info
                            .as_ref()
                            .map(|t| t.team_name.as_str())
                            .unwrap_or("\u{ffff}"); // Sort no-team last
                        let team_b = b
                            .team_info
                            .as_ref()
                            .map(|t| t.team_name.as_str())
                            .unwrap_or("\u{ffff}");
                        team_a.cmp(team_b).then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::Repository => {
                        // Sort by git common_dir (groups main + worktrees together)
                        // Non-git agents fall back to cwd
                        let key_a = a.git_common_dir.as_deref().unwrap_or(&a.cwd);
                        let key_b = b.git_common_dir.as_deref().unwrap_or(&b.cwd);
                        key_a.cmp(key_b).then_with(|| {
                            // Within same repo: main first, then worktrees alphabetically
                            let wt_a = a.is_worktree.unwrap_or(false);
                            let wt_b = b.is_worktree.unwrap_or(false);
                            wt_a.cmp(&wt_b).then_with(|| a.cwd.cmp(&b.cwd))
                        })
                    }
                },
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });

        // Post-sort: nest team members under their leader
        self.nest_team_members();
    }

    /// Reorder agent_order so team members appear directly after their leader
    fn nest_team_members(&mut self) {
        let agents = &self.agents;

        // Collect team info: team_name → (leader_id, [(member_name, member_id)])
        let mut team_leaders: HashMap<String, String> = HashMap::new();
        let mut team_members: HashMap<String, Vec<(String, String)>> = HashMap::new();

        for id in &self.agent_order {
            if let Some(agent) = agents.get(id) {
                if let Some(ref ti) = agent.team_info {
                    if ti.is_lead {
                        team_leaders.insert(ti.team_name.clone(), id.clone());
                    } else {
                        team_members
                            .entry(ti.team_name.clone())
                            .or_default()
                            .push((ti.member_name.clone(), id.clone()));
                    }
                }
            }
        }

        // If no teams found, skip
        if team_leaders.is_empty() && team_members.is_empty() {
            return;
        }

        // For teams without a detected leader, use the first member as implicit leader
        for (team_name, members) in &team_members {
            if !team_leaders.contains_key(team_name) {
                if let Some((_, first_member_id)) = members.first() {
                    team_leaders.insert(team_name.clone(), first_member_id.clone());
                }
            }
        }

        // Remove implicit leaders from team_members so they don't get skipped
        for (team_name, leader_id) in &team_leaders {
            if let Some(members) = team_members.get_mut(team_name) {
                members.retain(|(_, id)| id != leader_id);
            }
        }

        // Sort members by name for stable ordering
        for members in team_members.values_mut() {
            members.sort_by(|a, b| a.0.cmp(&b.0));
        }

        // Build new order: for each item, if it's a leader, insert its members right after
        let member_ids: std::collections::HashSet<String> = team_members
            .values()
            .flatten()
            .map(|(_, id)| id.clone())
            .collect();

        let mut new_order = Vec::with_capacity(self.agent_order.len());
        for id in &self.agent_order {
            // Skip members here (they'll be inserted after their leader)
            if member_ids.contains(id) {
                continue;
            }

            new_order.push(id.clone());

            // If this is a leader, insert members after it
            if let Some(agent) = agents.get(id) {
                if let Some(ref ti) = agent.team_info {
                    if let Some(members) = team_members.get(&ti.team_name) {
                        if team_leaders.get(&ti.team_name) == Some(id) {
                            for (_, member_id) in members {
                                // Don't add the leader again if it happens to be in members list
                                if member_id != id {
                                    new_order.push(member_id.clone());
                                }
                            }
                        }
                    }
                }
            }
        }

        self.agent_order = new_order;
    }

    /// Get priority for status sorting (lower = higher priority)
    fn status_priority(status: &crate::agents::AgentStatus) -> u8 {
        match status {
            crate::agents::AgentStatus::AwaitingApproval { .. } => 0, // Highest priority
            crate::agents::AgentStatus::Error { .. } => 1,
            crate::agents::AgentStatus::Processing { .. } => 2,
            crate::agents::AgentStatus::Idle => 3,
            crate::agents::AgentStatus::Offline => 4,
            crate::agents::AgentStatus::Unknown => 5,
        }
    }

    /// Get the current group key for an agent (for display headers)
    pub fn get_group_key(&self, agent: &MonitoredAgent) -> Option<String> {
        match self.sort_by {
            SortBy::Directory => Some(agent.display_cwd()),
            SortBy::SessionOrder => Some(agent.session.clone()),
            SortBy::AgentType => Some(agent.agent_type.short_name().to_string()),
            SortBy::Team => Some(
                agent
                    .team_info
                    .as_ref()
                    .map(|t| format!("Team: {}", t.team_name))
                    .unwrap_or_else(|| "(No Team)".to_string()),
            ),
            SortBy::Repository => Some(
                agent
                    .git_common_dir
                    .as_deref()
                    .map(crate::git::repo_name_from_common_dir)
                    .unwrap_or_else(|| agent.display_cwd()),
            ),
            _ => None,
        }
    }

    /// Toggle collapse state for a group
    pub fn toggle_group_collapse(&mut self, group_key: &str) {
        if self.selection.collapsed_groups.contains(group_key) {
            self.selection.collapsed_groups.remove(group_key);
        } else {
            self.selection
                .collapsed_groups
                .insert(group_key.to_string());
        }
    }

    /// Check if a group is collapsed
    pub fn is_group_collapsed(&self, group_key: &str) -> bool {
        self.selection.collapsed_groups.contains(group_key)
    }

    /// Move selection up
    pub fn select_previous(&mut self) {
        if self.selection.selected_entry_index > 0 {
            self.selection.selected_entry_index -= 1;
            self.view.preview_scroll = 0;
            self.sync_selected_index_from_entry();
            self.reset_marquee_for_selection();
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        if self.selection.selectable_count > 0
            && self.selection.selected_entry_index < self.selection.selectable_count - 1
        {
            self.selection.selected_entry_index += 1;
            self.view.preview_scroll = 0;
            self.sync_selected_index_from_entry();
            self.reset_marquee_for_selection();
        }
    }

    /// Select first entry
    pub fn select_first(&mut self) {
        if self.selection.selectable_count > 0 {
            self.selection.selected_entry_index = 0;
            self.view.preview_scroll = 0;
            self.sync_selected_index_from_entry();
            self.reset_marquee_for_selection();
        }
    }

    /// Select last entry
    pub fn select_last(&mut self) {
        if self.selection.selectable_count > 0 {
            self.selection.selected_entry_index = self.selection.selectable_count - 1;
            self.view.preview_scroll = 0;
            self.sync_selected_index_from_entry();
            self.reset_marquee_for_selection();
        }
    }

    /// Reset marquee state based on current selection
    fn reset_marquee_for_selection(&mut self) {
        let new_id = self.selected_target().map(|s| s.to_string());
        self.reset_marquee(new_id);
    }

    /// Sync selected_index from selected_entry_index
    /// This maps the entry index back to agent_order index for preview display
    fn sync_selected_index_from_entry(&mut self) {
        // This will be properly synced when build_entries is called during render
        // For now, just ensure selected_index stays valid
        if !self.agent_order.is_empty() && self.selection.selected_index >= self.agent_order.len() {
            self.selection.selected_index = self.agent_order.len() - 1;
        }
    }

    /// Update selectable count and sync entry index
    pub fn update_selectable_entries(
        &mut self,
        selectable_count: usize,
        agent_index: Option<usize>,
    ) {
        self.selection.selectable_count = selectable_count;
        self.selection.is_on_create_new = agent_index.is_none();
        if let Some(idx) = agent_index {
            self.selection.selected_index = idx;
        }
        // Ensure entry index is valid
        if self.selection.selected_entry_index >= selectable_count && selectable_count > 0 {
            self.selection.selected_entry_index = selectable_count - 1;
        }
    }

    /// Get all unique directories from current agents
    pub fn get_known_directories(&self) -> Vec<String> {
        let mut dirs: Vec<String> = self.agents.values().map(|a| a.cwd.clone()).collect();
        dirs.sort();
        dirs.dedup();
        dirs
    }

    /// Toggle help screen
    pub fn toggle_help(&mut self) {
        self.view.show_help = !self.view.show_help;
        if self.view.show_help {
            self.view.help_scroll = 0;
        }
    }

    /// Toggle QR code screen
    pub fn toggle_qr(&mut self) {
        self.view.show_qr = !self.view.show_qr;
    }

    /// Initialize web settings
    pub fn init_web(&mut self, token: String, port: u16) {
        self.web.token = Some(token);
        self.web.port = port;
    }

    /// Get web URL for QR code
    ///
    /// In WSL environments, returns Windows host IP instead of WSL internal IP,
    /// since external devices (phones) cannot access WSL's internal network directly.
    pub fn get_web_url(&self) -> Option<String> {
        let token = self.web.token.as_ref()?;

        // Try to get Windows host IP if running in WSL
        if let Some(host_ip) = get_wsl_host_ip() {
            return Some(format!(
                "http://{}:{}/?token={}",
                host_ip, self.web.port, token
            ));
        }

        // Fall back to local IP detection
        if let Ok(ip) = local_ip_address::local_ip() {
            Some(format!("http://{}:{}/?token={}", ip, self.web.port, token))
        } else {
            Some(format!(
                "http://localhost:{}/?token={}",
                self.web.port, token
            ))
        }
    }

    /// Scroll help screen down
    pub fn scroll_help_down(&mut self, amount: u16) {
        self.view.help_scroll = self.view.help_scroll.saturating_add(amount);
    }

    /// Scroll help screen up
    pub fn scroll_help_up(&mut self, amount: u16) {
        self.view.help_scroll = self.view.help_scroll.saturating_sub(amount);
    }

    /// Scroll preview down
    pub fn scroll_preview_down(&mut self, amount: u16) {
        self.view.preview_scroll = self.view.preview_scroll.saturating_add(amount);
    }

    /// Scroll preview up
    pub fn scroll_preview_up(&mut self, amount: u16) {
        self.view.preview_scroll = self.view.preview_scroll.saturating_sub(amount);
    }

    /// Get agents that need attention (awaiting approval or error)
    pub fn agents_needing_attention(&self) -> Vec<&MonitoredAgent> {
        self.agent_order
            .iter()
            .filter_map(|id| self.agents.get(id))
            .filter(|a| a.status.needs_attention())
            .collect()
    }

    /// Get count of agents needing attention
    pub fn attention_count(&self) -> usize {
        self.agents_needing_attention().len()
    }

    /// Set error message
    pub fn set_error(&mut self, message: String) {
        self.error_message = Some(message);
    }

    /// Clear error message
    pub fn clear_error(&mut self) {
        self.error_message = None;
    }

    /// Stop the application
    pub fn quit(&mut self) {
        self.running = false;
    }

    // =========================================
    // Input mode methods
    // =========================================

    /// Enter input mode
    pub fn enter_input_mode(&mut self) {
        self.input.mode = InputMode::Input;
    }

    /// Enter passthrough mode
    pub fn enter_passthrough_mode(&mut self) {
        self.input.mode = InputMode::Passthrough;
    }

    /// Exit input mode and clear buffer
    pub fn exit_input_mode(&mut self) {
        self.input.mode = InputMode::Normal;
        self.input.buffer.clear();
        self.input.cursor_position = 0;
    }

    /// Check if in input mode
    pub fn is_input_mode(&self) -> bool {
        self.input.mode == InputMode::Input
    }

    /// Check if in passthrough mode
    pub fn is_passthrough_mode(&self) -> bool {
        self.input.mode == InputMode::Passthrough
    }

    /// Get the input buffer
    pub fn get_input(&self) -> &str {
        &self.input.buffer
    }

    /// Get cursor position
    pub fn get_cursor_position(&self) -> usize {
        self.input.cursor_position
    }

    /// Insert a character at cursor position
    pub fn input_char(&mut self, c: char) {
        self.input.buffer.insert(self.input.cursor_position, c);
        self.input.cursor_position += c.len_utf8();
    }

    /// Delete character before cursor (backspace)
    pub fn input_backspace(&mut self) {
        if self.input.cursor_position > 0 {
            // Find the previous character boundary
            let prev_char_boundary = self.input.buffer[..self.input.cursor_position]
                .char_indices()
                .last()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.input.buffer.remove(prev_char_boundary);
            self.input.cursor_position = prev_char_boundary;
        }
    }

    /// Delete character at cursor (delete key)
    pub fn input_delete(&mut self) {
        if self.input.cursor_position < self.input.buffer.len() {
            self.input.buffer.remove(self.input.cursor_position);
        }
    }

    /// Move cursor left
    pub fn cursor_left(&mut self) {
        if self.input.cursor_position > 0 {
            // Find the previous character boundary
            self.input.cursor_position = self.input.buffer[..self.input.cursor_position]
                .char_indices()
                .last()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    /// Move cursor right
    pub fn cursor_right(&mut self) {
        if self.input.cursor_position < self.input.buffer.len() {
            // Find the next character boundary
            if let Some(c) = self.input.buffer[self.input.cursor_position..]
                .chars()
                .next()
            {
                self.input.cursor_position += c.len_utf8();
            }
        }
    }

    /// Move cursor to start
    pub fn cursor_home(&mut self) {
        self.input.cursor_position = 0;
    }

    /// Move cursor to end
    pub fn cursor_end(&mut self) {
        self.input.cursor_position = self.input.buffer.len();
    }

    /// Take the input buffer content and clear it
    pub fn take_input(&mut self) -> String {
        let input = std::mem::take(&mut self.input.buffer);
        self.input.cursor_position = 0;
        input
    }

    // =========================================
    // Create process methods
    // =========================================

    /// Start create process flow from a group
    pub fn start_create_process(
        &mut self,
        group_key: String,
        panes: Vec<PaneInfo>,
        config: &CreateProcessSettings,
    ) {
        // Get known directories from current agents
        let known_directories = self.get_known_directories();

        // Build directory items from config + known dirs
        let directory_items = build_directory_items(config, known_directories);

        // Pre-select directory if sorted by Directory
        let directory = if self.sort_by == SortBy::Directory {
            Some(group_key.clone())
        } else {
            None
        };

        // Pre-select session if sorted by SessionOrder
        let target_session = if self.sort_by == SortBy::SessionOrder {
            Some(group_key.clone())
        } else {
            None
        };

        // Get currently selected pane target for SplitPane
        let target_pane = self.selected_target().map(|s| s.to_string());

        // Initialize collapsed_nodes: sessions expanded, windows collapsed
        let mut collapsed_nodes = HashSet::new();
        for pane in &panes {
            // Collapse all windows by default
            let window_key = format!("{}:{}", pane.session, pane.window_index);
            collapsed_nodes.insert(window_key);
        }

        // Build tree entries
        let tree_entries = Self::build_tree_entries(&panes, &collapsed_nodes);

        self.create_process = Some(CreateProcessState {
            step: CreateProcessStep::SelectTarget,
            placement_type: None,
            origin_group_key: group_key,
            target_session,
            target_pane,
            directory,
            cursor: 0,
            input_buffer: String::new(),
            available_panes: panes,
            collapsed_nodes,
            tree_entries,
            directory_items,
            is_input_mode: false,
        });
    }

    /// Build tree entries from panes and collapsed state
    fn build_tree_entries(panes: &[PaneInfo], collapsed_nodes: &HashSet<String>) -> Vec<TreeEntry> {
        let mut entries = Vec::new();

        // Group panes by session, then by window
        let mut sessions: Vec<String> = panes.iter().map(|p| p.session.clone()).collect();
        sessions.sort();
        sessions.dedup();

        // Existing sessions/windows/panes first (current location options)
        for session in &sessions {
            let session_collapsed = collapsed_nodes.contains(session);
            entries.push(TreeEntry::Session {
                name: session.clone(),
                collapsed: session_collapsed,
            });

            if !session_collapsed {
                // Collect windows in this session
                let mut windows: Vec<(u32, String)> = panes
                    .iter()
                    .filter(|p| &p.session == session)
                    .map(|p| (p.window_index, p.window_name.clone()))
                    .collect();
                windows.sort_by_key(|(idx, _)| *idx);
                windows.dedup_by_key(|(idx, _)| *idx);

                for (window_index, window_name) in windows {
                    let window_key = format!("{}:{}", session, window_index);
                    let window_collapsed = collapsed_nodes.contains(&window_key);

                    entries.push(TreeEntry::Window {
                        session: session.clone(),
                        index: window_index,
                        name: window_name,
                        collapsed: window_collapsed,
                    });

                    if !window_collapsed {
                        // Add panes under this window
                        let window_panes: Vec<&PaneInfo> = panes
                            .iter()
                            .filter(|p| &p.session == session && p.window_index == window_index)
                            .collect();

                        for pane in window_panes {
                            entries.push(TreeEntry::SplitPane {
                                target: pane.target.clone(),
                            });
                        }
                    }
                }

                // Add "New Window" at the bottom of the session
                entries.push(TreeEntry::NewWindow {
                    session: session.clone(),
                });
            }
        }

        // Add "New Session" at the bottom
        entries.push(TreeEntry::NewSession);

        entries
    }

    /// Toggle a node's collapsed state in the create process tree
    pub fn toggle_tree_node(&mut self, key: &str) {
        if let Some(ref mut cs) = self.create_process {
            if cs.collapsed_nodes.contains(key) {
                cs.collapsed_nodes.remove(key);
            } else {
                cs.collapsed_nodes.insert(key.to_string());
            }
            // Rebuild tree entries
            cs.tree_entries = Self::build_tree_entries(&cs.available_panes, &cs.collapsed_nodes);
        }
    }

    /// Cancel create process flow
    pub fn cancel_create_process(&mut self) {
        self.create_process = None;
    }

    /// Check if in create process mode
    pub fn is_create_process_mode(&self) -> bool {
        self.create_process.is_some()
    }

    // =========================================
    // Confirmation dialog methods
    // =========================================

    /// Show a confirmation dialog
    pub fn show_confirmation(&mut self, action: ConfirmAction, message: String) {
        self.confirmation_state = Some(ConfirmationState { action, message });
    }

    /// Cancel the confirmation dialog
    pub fn cancel_confirmation(&mut self) {
        self.confirmation_state = None;
    }

    /// Check if confirmation dialog is showing
    pub fn is_showing_confirmation(&self) -> bool {
        self.confirmation_state.is_some()
    }

    /// Get the confirmation action (for execution)
    pub fn get_confirmation_action(&self) -> Option<ConfirmAction> {
        self.confirmation_state.as_ref().map(|s| s.action.clone())
    }

    /// Move cursor up in create process popup (skips headers in directory step)
    pub fn create_process_cursor_up(&mut self) {
        if let Some(ref mut state) = self.create_process {
            if state.cursor > 0 {
                state.cursor -= 1;
                // Skip headers when in directory selection step
                if state.step == CreateProcessStep::SelectDirectory {
                    let len = state.directory_items.len();
                    if len == 0 {
                        state.cursor = 0;
                        return;
                    }
                    while state.cursor > 0 && !state.directory_items[state.cursor].is_selectable() {
                        state.cursor -= 1;
                    }
                    // If we landed on a header at position 0, move forward
                    if !state.directory_items[state.cursor].is_selectable() {
                        while state.cursor < len
                            && !state.directory_items[state.cursor].is_selectable()
                        {
                            state.cursor += 1;
                        }
                    }
                }
            }
        }
    }

    /// Move cursor down in create process popup (skips headers in directory step)
    pub fn create_process_cursor_down(&mut self, max: usize) {
        if let Some(ref mut state) = self.create_process {
            if state.cursor < max.saturating_sub(1) {
                state.cursor += 1;
                // Skip headers when in directory selection step
                if state.step == CreateProcessStep::SelectDirectory {
                    let len = state.directory_items.len();
                    while state.cursor < len && !state.directory_items[state.cursor].is_selectable()
                    {
                        state.cursor += 1;
                    }
                    // Clamp to last valid item
                    if state.cursor >= len {
                        // Find last selectable item
                        state.cursor = len.saturating_sub(1);
                        while state.cursor > 0
                            && !state.directory_items[state.cursor].is_selectable()
                        {
                            state.cursor -= 1;
                        }
                    }
                }
            }
        }
    }

    /// Get create process cursor position
    pub fn create_process_cursor(&self) -> usize {
        self.create_process.as_ref().map(|s| s.cursor).unwrap_or(0)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Expand `~` prefix to the user's home directory
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            return path.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

/// Build the directory selection items list from config and known directories
fn build_directory_items(
    config: &CreateProcessSettings,
    known_directories: Vec<String>,
) -> Vec<DirItem> {
    let mut items = vec![DirItem::EnterPath, DirItem::Home, DirItem::Current];

    // Pinned directories
    if !config.pinned.is_empty() {
        let mut pinned_items: Vec<DirItem> = Vec::new();
        for dir in &config.pinned {
            let expanded = expand_tilde(dir);
            if std::path::Path::new(&expanded).is_dir() {
                pinned_items.push(DirItem::Directory {
                    display: dir.to_string(),
                    path: expanded,
                });
            }
        }
        if !pinned_items.is_empty() {
            items.push(DirItem::Header("Pinned".to_string()));
            items.extend(pinned_items);
        }
    }

    // Base directories (scan subdirectories)
    for base in &config.base_directories {
        let expanded = expand_tilde(base);
        if let Ok(entries) = std::fs::read_dir(&expanded) {
            let mut subdirs: Vec<(String, String)> = entries
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let path = e.path().to_string_lossy().to_string();
                    (name, path)
                })
                .collect();
            subdirs.sort_by(|a, b| a.0.cmp(&b.0));

            if !subdirs.is_empty() {
                items.push(DirItem::Header(base.to_string()));
                for (name, path) in subdirs {
                    items.push(DirItem::Directory {
                        display: name,
                        path,
                    });
                }
            }
        }
    }

    // Known directories (from running agents), excluding already-listed paths
    let existing_paths: HashSet<String> = items
        .iter()
        .filter_map(|item| match item {
            DirItem::Directory { path, .. } => Some(path.clone()),
            _ => None,
        })
        .collect();
    let unique_known: Vec<String> = known_directories
        .into_iter()
        .filter(|d| !existing_paths.contains(d))
        .collect();
    if !unique_known.is_empty() {
        items.push(DirItem::Header("Known".to_string()));
        for dir in unique_known {
            let display = if dir.chars().count() > 40 {
                let tail: String = dir
                    .chars()
                    .rev()
                    .take(37)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                format!("...{}", tail)
            } else {
                dir.clone()
            };
            items.push(DirItem::Directory { display, path: dir });
        }
    }

    items
}

/// Detect if running in WSL and return the appropriate external IP
///
/// WSL2 has two networking modes:
/// - NAT mode (default): External devices cannot access WSL directly, need Windows host IP
/// - Mirrored mode: WSL shares Windows network, WSL IP is directly accessible
///
/// This function detects the mode and returns the appropriate IP.
fn get_wsl_host_ip() -> Option<String> {
    // Check if running in WSL by reading /proc/version
    let proc_version = std::fs::read_to_string("/proc/version").ok()?;
    if !proc_version.to_lowercase().contains("microsoft")
        && !proc_version.to_lowercase().contains("wsl")
    {
        return None;
    }

    // Check if mirrored networking mode is enabled
    // In mirrored mode, WSL's own IP is directly accessible from external devices
    if is_wsl_mirrored_mode() {
        // Use local_ip_address to get WSL's IP (which is the same as Windows in mirrored mode)
        return None; // Let the caller use local_ip_address
    }

    // NAT mode: Windows host IP is typically the nameserver in /etc/resolv.conf
    let resolv_conf = std::fs::read_to_string("/etc/resolv.conf").ok()?;
    for line in resolv_conf.lines() {
        let line = line.trim();
        if line.starts_with("nameserver") {
            if let Some(ip) = line.split_whitespace().nth(1) {
                // Skip internal IPs (systemd-resolved, localhost, etc.)
                if ip.starts_with("10.255.") || ip.starts_with("127.") {
                    continue;
                }
                // Validate it looks like an IP address
                if ip.parse::<std::net::Ipv4Addr>().is_ok() {
                    return Some(ip.to_string());
                }
            }
        }
    }

    None
}

/// Check if WSL is running in mirrored networking mode
fn is_wsl_mirrored_mode() -> bool {
    // Check .wslconfig in common locations
    if let Ok(home) = std::env::var("USERPROFILE") {
        let wslconfig_path = format!("{}\\.wslconfig", home);
        if let Ok(content) = std::fs::read_to_string(&wslconfig_path) {
            return content.to_lowercase().contains("networkingmode=mirrored");
        }
    }

    // Try Windows user directories via /mnt/c
    if let Ok(entries) = std::fs::read_dir("/mnt/c/Users") {
        for entry in entries.flatten() {
            let path = entry.path().join(".wslconfig");
            if let Ok(content) = std::fs::read_to_string(&path) {
                if content.to_lowercase().contains("networkingmode=mirrored") {
                    return true;
                }
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType};

    fn create_test_agent(id: &str) -> MonitoredAgent {
        MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Test".to_string(),
            "/home".to_string(),
            1234,
            "main".to_string(),
            "window".to_string(),
            0,
            0,
        )
    }

    #[test]
    fn test_new_state() {
        let state = AppState::new();
        assert!(state.agents.is_empty());
        assert!(state.running);
    }

    #[test]
    fn test_update_agents() {
        let mut state = AppState::new();
        let agents = vec![create_test_agent("main:0.0"), create_test_agent("main:0.1")];

        state.update_agents(agents);

        assert_eq!(state.agents.len(), 2);
        assert_eq!(state.agent_order.len(), 2);
    }

    #[test]
    fn test_selection() {
        let mut state = AppState::new();
        let agents = vec![
            create_test_agent("main:0.0"),
            create_test_agent("main:0.1"),
            create_test_agent("main:0.2"),
        ];
        state.update_agents(agents);
        // Simulate selectable count: 3 agents + 1 CreateNew = 4
        state.selection.selectable_count = 4;

        assert_eq!(state.selection.selected_entry_index, 0);

        state.select_next();
        assert_eq!(state.selection.selected_entry_index, 1);

        state.select_next();
        assert_eq!(state.selection.selected_entry_index, 2);

        state.select_next();
        assert_eq!(state.selection.selected_entry_index, 3); // CreateNew entry

        state.select_next();
        assert_eq!(state.selection.selected_entry_index, 3); // Can't go past end

        state.select_previous();
        assert_eq!(state.selection.selected_entry_index, 2);

        state.select_first();
        assert_eq!(state.selection.selected_entry_index, 0);

        state.select_last();
        assert_eq!(state.selection.selected_entry_index, 3);
    }

    #[test]
    fn test_attention_count() {
        let mut state = AppState::new();
        let mut agent1 = create_test_agent("main:0.0");
        agent1.status = AgentStatus::Idle;

        let mut agent2 = create_test_agent("main:0.1");
        agent2.status = AgentStatus::AwaitingApproval {
            approval_type: crate::agents::ApprovalType::FileEdit,
            details: String::new(),
        };

        state.update_agents(vec![agent1, agent2]);

        assert_eq!(state.attention_count(), 1);
    }
}
