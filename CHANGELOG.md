# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **UserInputDuringProcessing audit event**: Detects potential false negatives in agent state detection
  - Logs when user sends input while agent status is Processing or Idle (likely missed approval prompt)
  - Sources: TUI input mode, passthrough mode (5s debounce), Web API `/input` endpoint
  - Extended to normal mode: y-key, number-key, Enter-key when agent is not in AwaitingApproval
  - Includes detection context (rule, confidence, screen content) for post-hoc analysis
  - Cross-thread architecture: mpsc channel bridges UI/Web threads to Poller's audit logger
- **Compacting status label**: Shows "Compacting" instead of "Processing" during `/compact` operation
  - Detects `compacting` keyword in Processing activity text from spinner detection

### Fixed
- **Blank preview after `/compact`**: Preview no longer shows empty area after terminal clear
  - Trailing empty lines are trimmed before calculating visible content range
  - Fixes issue where `capture-pane` returns content at top with empty lines below cursor

## [0.2.5]

### Added
- **IPC communication**: PTY wrapper ↔ parent process communication migrated from file-based state to Unix domain socket (`/tmp/tmai/control.sock`)
  - Bidirectional: state push (wrapper → parent) + keystroke forwarding (parent → wrapper via IPC direct PTY write)
  - IPC-first with tmux fallback for all send_keys operations
  - Exponential backoff reconnection in IPC client
- **Detection audit log**: ndjson-format logging of detection events for debugging and precision analysis (`--audit` flag)
  - Events: `StateChanged`, `AgentAppeared`, `AgentDisappeared`, `SourceDisagreement`
  - Detection reasoning: each result includes rule name, confidence level (High/Medium/Low), and matched text
  - 36 detection rules across 4 detectors (claude_code, codex, gemini, default)
  - Log rotation at 10MB (`/tmp/tmai/audit/detection.ndjson`)
  - Disabled by default; enable via `--audit` CLI flag or `[audit] enabled = true`
- `[audit]` configuration section with `enabled`, `max_size_bytes`, `log_source_disagreement` options
- Content-area spinner detection for Claude Code (`✶`, `✻`, `✽`, `*` + verb + `…` pattern)
  - Fixes false idle during `/compact` when title still shows `✳` but content has active spinner

### Changed
- Detection source renamed: `DetectionSource::PtyStateFile` → `IpcSocket`
- `src/wrap/state_file.rs` removed; types moved to `src/ipc/protocol.rs`

### Fixed
- False idle detection during Claude Code `/compact` operation
  - Title shows `✳` (idle) while content shows active spinner verb (e.g., `✶ Spinning…`)
  - Content spinner check now runs before title-based idle detection
- Low-confidence fallback detections for `✻ Levitating…`, `* Working…` etc. upgraded to Medium confidence

## [0.2.4]

### Security
- Web API now supports `Authorization: Bearer <token>` header authentication
  - Header takes priority over query parameter when present
  - Query parameter fallback preserved for SSE EventSource connections
- Frontend `fetch()` calls migrated to use Authorization header instead of URL query parameter

### Improved
- Team member search optimized with HashMap-based cmdline cache (eliminates duplicate PID lookups)
- Task summary counts pre-computed in TeamSnapshot (avoids per-frame iteration)
- API operation logging added for state-changing endpoints (approve, select, submit, input)

### Fixed
- State directory creation race condition (TOCTOU) in PTY wrapper
  - Now uses idempotent `create_dir_all` + metadata verification + permission auto-repair
- Defensive digit parsing in key handler (`unwrap()` → `unwrap_or(0)`)

### Added
- Web API test suite with 12 test cases covering all endpoints
  - Empty state, 404, 400, path traversal validation, agent state checks

## [0.2.3]

### Improved
- Session list layout reorganized for better visibility
  - Line 1: AI name, team badge, context warning, status label
  - Line 2: Title (marquee), detection icon, pid, window/pane meta
- "New Process" and "New Session/Window" options moved to the bottom of their respective lists

## [0.2.2]

### Improved
- Session list display compressed from 4 lines to 2 lines per agent (50% vertical space reduction)

### Added
- CI workflow for develop → master pull requests

## [0.2.1]

### Improved
- Directory group headers now show the **tail** of long paths instead of the head
  - e.g., `...conversation-handoff-mcp` instead of `/home/trustdelta/wo...`
  - Selected items still use marquee scrolling for full path visibility
- Team members now display `activeForm` from task files as their title when processing
  - e.g., "Fixing authentication bug" instead of the tmux pane title
  - Falls back to pane title when `activeForm` is not available

## [0.2.0]

### Added
- Agent Teams integration for Claude Code team monitoring
  - Team overview screen (`T` key)
  - Task overlay for team members (`t` key)
  - Team structure and task progress visualization
- Web API endpoints for teams (`/api/teams`, `/api/teams/{name}/tasks`)
- SSE event type `teams` for real-time team updates
- `[teams]` configuration section
- Documentation updates for Agent Teams across all docs (EN/JA)

### Changed
- Sort (`s`) and monitor scope (`m`) keys temporarily disabled
  - Sort fixed to Directory, scope fixed to AllSessions
- Status bar: replaced `s:Sort`/`m:Scope` hints with `t:Tasks`/`T:Teams`
- Help screen: `s` and `m` keys grayed out, Agent Teams section added

### Fixed
- Removed stale `n` (reject) key references from documentation
- Removed stale "Reject" button from Web Remote documentation

## [0.1.4]

### Changed
- Approval key now sends Enter instead of 'y' (matches Claude Code's cursor-based UI)
- Removed rejection key 'n' (use number keys, input mode, or passthrough mode instead)

### Added
- Comprehensive documentation in `doc/` (English) and `doc/ja/` (Japanese)
  - Feature guides: PTY wrapping, AskUserQuestion, Exfil detection, Web Remote
  - Workflow guides: Single/Multi-agent monitoring, Worktree parallel dev, Remote approval
  - Reference: Keybindings, Configuration, Web API

## [0.1.3]

### Added
- External transmission detection for PTY wrap mode (security monitoring)
- CHANGELOG.md

### Fixed
- Staircase newline display in PTY wrap mode

## [0.1.2]

### Changed
- Localize UI to English

## [0.1.0]

Initial public release on crates.io.

### Added
- Web Remote Control for smartphone operation via QR code
- PTY wrapping for high-precision agent state detection
- WSL mirrored networking mode support
- Detection source display (PTY vs capture-pane)
- Tree-style target selection for new process creation
- Split direction toggle (horizontal/vertical layout)
- Collapsible group headers in session list
- Custom spinnerVerbs detection for Claude Code
- Agent list sorting feature
- Passthrough mode for direct key input
- Input mode for text entry
- Create session/process feature with agent selection
- cmdline-based agent detection
- ANSI color support in preview
- Open new tmux session in wezterm tab

### Fixed
- False agent detection for file managers (yazi, etc.)
- Codex idle detection when slash command menu is shown
- False positive in Codex approval detection
- AskUserQuestion detection with multiple numbered lists
- Session detection with multiple attached clients
- Preview not showing bottom lines

## [0.0.1]

### Added
- Initial implementation of tmai (Tmux Multi Agent Interface)
- Monitor multiple AI agents (Claude Code, Codex CLI, Gemini CLI)
- Real-time pane preview
- Approval/rejection key shortcuts
- AskUserQuestion selection support
