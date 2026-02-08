# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
