# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note**: Version numbers were reset at v0.1.0 with the WebUI-first rewrite.
> For the TUI-era changelog (v0.0.1–v0.20.0), see [Legacy Changelog](#legacy-tui-era-v001v0200).

## [1.5.0] - 2026-04-05

### Added

- Orchestrator Agent with per-project workflow settings and Spawn Dialog integration (#226)
- send_prompt API/MCP for queuing prompts to idle/stopped agents (#225)
- dispatch_issue MCP tool for one-shot issue-to-agent workflow (#223)
- Issue context in spawn_worktree MCP tool via issue_number param (#222)
- Auto-rebase stale PRs after merge with conflict notification (#224)
- Stable agent IDs independent of tmux pane numbering (#232)
- Light mode / theme toggle with system preference support (#221)
- Browser notification when agent stops with idle threshold (#217)
- Click-to-copy commit SHA in git panel (#216)
- Issue-to-PR progress tracker in Issues tab (#201)
- Styled transcript rendering with Claude Code UI patterns (#200)
- Responsive layout for narrow viewports (#197)
- Bulk delete merged branches (#199)
- MCP server documentation (EN/JA) (#198)

### Fixed

- Kill tmux pane before worktree deletion (#202)
- Block worktree deletion during pending agent detection window (#220)

### Improved

- Reduce O(n²) complexity in compute_branch_parents() (#219)
- Make audit validation periodic instead of every-poll (#214)
- Extract repo validation helper for GitHub API endpoints (#209)
- Deduplicate CI status rollup computation (#205)
- Deduplicate session lookup functions (#206)
- Extract common fallback chain in CommandSender (#207)
- Replace custom floor_char_boundary with std (#211)

## [1.4.0] - 2026-04-04

### Added

- MCP server for programmatic agent orchestration (#186)
- Context-aware action buttons based on branch state in git panel (#187)
- Issue detail view in Issues tab, similar to PR detail panel (#189)
- PermissionDenied hook event integration into audit system (#190)
- Relative commit date display on branches in git panel (#193)
- TaskCreated hook event integration for task monitoring (#194)

### Fixed

- Add repo parameter to MCP GitHub/Git tools (#188)
- Add type field and write MCP server config to ~/.claude.json (#191)
- Preserve existing statusLine tool in tmai init (#191)
- Add repo parameter to spawn_worktree MCP tool
- Auto-force delete for squash-merged branches (#196)

## [1.3.0] - 2026-04-03

### Added

- JSONL web-native rendering: react-markdown + remark-gfm based transcript view with collapsible thinking blocks, expandable tool details, and tool-specific color coding (#183)
- Move to Worktree action for in-progress branches in git panel (#185)

### Changed

- Scope TUI-era keyboard shortcuts (h/j/k/l etc.) to TUI mode only in WebUI (#184)

### Improved

- TranscriptRecord now includes uuid, timestamp, thinking blocks, full tool input, and error status for richer data

## [1.2.1] - 2026-04-02

### Fixed

- Transcript record limit increased from 50 to 10,000 for full session scrollback (#179)
- Initial transcript load now reads full session history instead of last 100 lines (#180)

## [1.2.0] - 2026-04-01

### Added

- **Hybrid scrollback preview** — Live area uses capture-pane (ANSI), history area uses JSONL transcript. Resilient to context compaction and scrollback resets (#177)
- **Hook-based auto-approve via Defer Permission** — PreToolUse hooks can defer tool execution for tmai's Rules/AI/Hybrid evaluation. Zero-latency, structured data, no keystroke injection (#178)
- Documentation updates for hooks (PermissionDenied, TaskCreated events), terminal panel, worktree UI, and auto-approve

## [1.1.3] - 2026-04-01

### Added

- Unified PR card design between source and target views with CI status labels (#172)
- Sidebar icon state syncs with active right pane panel (#167)
- Solid merge lines from merged PR branches to merge commit in git graph (#156)
- Statusline hook integration for improved agent info accuracy (#155)
- Press Enter to switch from select mode to input mode (#152)

### Fixed

- Issues tab now stays stable when spawning worktree from git panel (#171)
- Worktree delete works for paths under .git/.claude/worktrees/ (#169)
- Create & Resolve now sends initial prompt through spawnWorktree (#168)
- Straight lines instead of curves for PR base dashed lines in git panel (#154)

### Changed

- Renamed Security Scan to Config Audit and extended scan targets (#153)

## [1.1.2] - 2026-03-31

### Added

- **Create & Resolve button** — Launch agent with issue context and auto-PR directly from the git panel (#141)
- WebUI dashboard screenshot in README

### Fixed

- Cursor overlay misalignment when tmux panes are horizontally split (#143)
- Markdown panel root path not resolved in split-pane view (#146)
- Conversation panel false focus ring when right panel has focus (#148)
- Usage stats not auto-fetched on startup when enabled in settings (#149)
- Pre-commit hook silently skipped frontend checks in worktrees — now auto-installs node_modules

## [1.1.1] - 2026-03-30

### Fixed

- Hook errors on every PostToolUse event — `tool_response` type changed from `String` to `Value` to match Claude Code v2.1.87+ payload format (#139)

### Added

- Issue-driven orchestration workflow guide (`doc/workflows/issue-driven-orchestration.md`)

## [1.1.0] - 2026-03-30

### Added

- **Split-pane layout** — Conversation panel left, git/markdown panel right with draggable divider (#131)
- **Worktree status badges on issues** — Show "In Progress" or "Worktree" badges on issues with linked worktrees, plus "Go to Worktree" navigation button (#130)
- **Remote-only branches in git panel** — Display branches that exist only on remote (#121)

### Fixed

- Settings not hot-reloading after PUT API calls (#128)
- Branch delete now offers checkbox to also delete remote tracking branch (#126)
- Git panel header shows correct total commit count (#124)
- Web assets rebuild for remote branches feature (#122)

### Security

- Update picomatch 4.0.3 → 4.0.4 (CVE fix) (#133)

## [1.0.0] - 2026-03-30

WebUI-first rewrite. The default mode is now a React + Vite web application with glassmorphism design.
TUI mode remains available via `--tmux` flag.

### Added

- **WebUI-first frontend** — React 19 + Vite + Tailwind v4, glassmorphism design, Chrome App Mode auto-open
- **Interactive terminal** — Full xterm.js terminal with WebGL rendering, WebSocket I/O, PTY spawn
- **Branch graph** — GitKraken-style lane-based SVG commit graph with branch hierarchy
- **GitHub integration** — PR status, CI checks (with re-run), issues panel, branch-to-issue linking, worktree-from-issue
- **Terminal cursor tracking** — Cyan block cursor overlay in preview panel
  - Two-tier detection: tmux `display-message` or `vt100` crate (IPC/wrap mode)
  - DOM marker injection for accurate positioning (handles line wrapping and CJK full-width characters)
  - Configurable via Settings panel (persists) or per-session footer toggle
- **RuntimeAdapter trait** — Abstraction over tmux/standalone runtime; enables WebUI without tmux
- **Standalone mode** — Hook/IPC-only operation, no tmux required
- **PTY spawn API** — Launch agents directly from WebUI with xterm.js terminal
- **Inter-agent messaging** — Send text between agents via `/agents/{from}/send-to/{to}`
- **Spawn bash terminal** — Open shell in tmux pane environment
- **Markdown viewer** — Browse and edit project documentation in-app
- **Worktree orchestration** — Create, delete, diff, and launch agents in Git worktrees from WebUI
- **Context compaction tracking** — Monitor compaction count (♻×N) and active subagents (⑂N) from hook events
- **Codex CLI WebSocket integration** — Connect to `codex app-server` JSON-RPC 2.0 API for real-time monitoring
- **Codex CLI hooks bridge** — `tmai codex-hook` + `tmai init --codex` for Codex event translation
- **Preview settings API** — `GET/PUT /api/settings/preview` with `[web] show_cursor` config option

### Changed

- Default mode switched from TUI to WebUI (use `--tmux` for TUI)
- Cargo workspace: 3-crate structure (tmai bin + tmai-core lib + tmai-app bin)

### Fixed

- HTTP hook 415 errors: accept raw bytes instead of requiring `Content-Type: application/json`
- Hook timeout unit corrected from milliseconds to seconds in `tmai init`
- rustls-webpki CRL matching vulnerability (updated to 0.103.10)
- HTTP hook timeout to prevent Claude Code stall when tmai is not running

### Dependencies

- vt100 0.16 (terminal cursor tracking)
- React 19, Vite 6, Tailwind v4, xterm.js 6, lucide-react
- tokio-tungstenite 0.29, notify 8.2, clap 4.6, ureq 3.3

---

## Legacy (TUI-era, v0.0.1–v0.20.0)

<details>
<summary>Click to expand TUI-era changelog</summary>

### v0.20.0 (2026-03-27)

- Git worktree orchestration (Phase B-1 + B-2)
- Context compaction tracking and subagent count from hook events

### v0.19.0 (2026-03-14)

- Codex CLI app-server WebSocket integration

### v0.18.0 (2026-03-11)

- Codex CLI hooks bridge integration

### v0.17.0 (2026-03-11)

- Effort level detection from Claude Code title icons

### v0.16.0 (2026-03-08)

- PreToolUse hook-based auto-approve with rule engine

### v0.15.0–v0.15.1 (2026-03-07)

- Stepwise preview split offset, review pane auto-close
- wezterm SSH domain fix

### v0.14.0 (2026-03-06)

- Fresh Session Review (hook-driven automatic code review)
- `line_wrap` config option

### v0.13.0 (2026-03-05)

- New Claude Code hook events (ConfigChange, WorktreeCreate/Remove, PreCompact)

### v0.12.0–v0.12.1 (2026-03-04)

- Worktree management (scan, list, create, overview screen)

### v0.11.0–v0.11.1 (2026-03-02–03)

- Hook-as-Teacher detection validation
- AskUserQuestion auto-approve fix

### v0.10.0–v0.10.3 (2026-03-01–02)

- Claude Code Hooks integration (event-driven detection)
- Security Monitor (9 rules)
- Hook payload format fixes

### v0.9.0 (2026-03-01)

- Security Monitor panel

### v0.8.0–v0.8.3 (2026-02-25–27)

- Usage monitoring, auto-refresh
- Agent definition scanner, Teams × Worktree mapping

### v0.7.0 (2026-02-25)

- Agent definition scanner, TeammateIdle/TaskCompleted notifications

### v0.6.0–v0.6.2 (2026-02-23–24)

- Facade API (TmaiCore), CoreEvent broadcast, Worktree monitoring, SortBy::Repository

### v0.5.0 (2026-02-21)

- Cargo workspace化 (tmai-core lib crate分離)

### v0.4.0–v0.4.5 (2026-02-19–21)

- Auto-approve (AI model), Web Remote voice input, IPC upgrade restart
- 4-mode auto-approve (Off/Rules/AI/Hybrid)

### v0.3.0–v0.3.2 (2026-02-14–18)

- Spinner grace period, git branch detection, demo mode
- Codex/Gemini detector improvements

### v0.2.0–v0.2.10 (2026-02-06–13)

- Agent Teams, IPC communication, detection audit log
- Permission mode detection, processing activity display
- Web API auth, external transmission detection

### v0.1.0–v0.1.4 (2026-01-27–02-05)

- Initial public release on crates.io
- Web Remote Control, PTY wrapping, passthrough mode
- Comprehensive documentation

### v0.0.1 (2026-01-25)

- Initial implementation

</details>
