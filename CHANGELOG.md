# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
