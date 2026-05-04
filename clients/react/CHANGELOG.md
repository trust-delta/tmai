# Changelog

All notable changes to `tmai-react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
UI-facing changes that depend on `api-spec/` updates note the minimum spec
version required (see the `api_spec` pin in [`versions.toml`](../../versions.toml)).

Each `tmai-react` version is bundled into a `tmai` release tarball; the
mapping is recorded next to the section header.

## [Unreleased]

### Refactored

- Settings panel decomposition: extract `AutoApproveSection`, `ProjectsSection`, `OrchestrationSection` (with `NotifySettingsSection` / `PrMonitorSection` / `GuardrailsSection` siblings), and DRY the orchestration handler triplets into a `ROLES` table and the role/rule textareas into a single auto-saved component (#581 #582 #583 #584 #585 #586 #587). `SettingsPanel.tsx` shrank ~75% (2097 → 530 lines).

### Fixed

- `DispatchBundleEditor` now mirrors the backend's `vendor_compat` permission-mode matrix so codex / gemini bundles can't be saved with disallowed modes (no more 400 round-trip) (#581).
- `ProjectsSection`: surface remove failures inline instead of swallowing the error; expose the inline error region as `role="alert"` for screen readers (#585).

## [1.2.0] — 2026-05-03 (bundled in [tmai v2.2.0](https://github.com/trust-delta/tmai/releases/tag/v2.2.0))

### Added

- Per-role dispatch bundle editor in Settings — vendor / model / permission_mode / effort for orchestrator / implementer / reviewer (#574).
- Spawn runtime radio selector — native enabled, tmux marked "coming soon" (#570).
- Hybrid auto-save in the Settings panel: atomic field changes persist on every interaction; text fields commit on blur or Enter (#579).

### Fixed

- Wire `OrchestrationDispatchSection` to `/settings/orchestrator` and clean up the Spawn section (#577).

## [1.1.0] — 2026-05-02 (bundled in [tmai v2.1.0](https://github.com/trust-delta/tmai/releases/tag/v2.1.0))

### Added

- xterm.js terminal plane: subscribe-terminal foundation + `TerminalPanel` migration (#557), `keyEventToBytes` keys-WebSocket utility (#558), gated WS transport in `PreviewPanel` (#559), and full WS-only retirement of the polling fallback (#563).
- Wire xterm onResize → `POST /api/agents/:id/resize` so the PTY size tracks the viewer's viewport (#565).
- Split the preview panel into Live and Transcript tabs to keep the common monitoring path off the heavier per-record markdown pipeline (#541).

### Fixed

- Per-agent ANSI replay buffer on agent switch (#560), then re-architected: PTY-server now flushes its own scrollback on attach so the React-side replay buffer was retired to remove a double-render regression (#561).
- Stop preemptive ticket refresh and reset xterm on reconnect (#562).
- Active-input poll cadence while the user is typing (#546).
- Auto-scroll honesty across agent switches (#544).
- Adapt to the rev3 wire envelope and dedupe agents (#541).

### Changed

- Drop the post-#96 defensive `Agent` envelope-id fallback now that wire unification has shipped (#548).

## [1.0.0] — 2026-04-23 (bundled in [tmai v2.0.0](https://github.com/trust-delta/tmai/releases/tag/v2.0.0))

Initial post-consolidation release. Content seeded from the archived
[`trust-delta/tmai-react`](https://github.com/trust-delta/tmai-react) repository on
2026-04-21 via `git subtree`. The pre-consolidation history is preserved in the
archived repo; this CHANGELOG starts from the consolidation point.

### Added

- React 19 + Vite + Tailwind v4 reference WebUI for `tmai-core`.
- Phase 2 wire migration: subscribe to the `Entity-Update` envelope + bootstrap-based load (drops polling) (#522 / #529).
- Drop derived calculations in favour of consuming the new Snapshot types straight from the contract (#521 / #527).

### Security

- Resolved all open Dependabot alerts (26 → 0).

[Unreleased]: https://github.com/trust-delta/tmai/compare/v2.2.0...HEAD
[1.2.0]: https://github.com/trust-delta/tmai/releases/tag/v2.2.0
[1.1.0]: https://github.com/trust-delta/tmai/releases/tag/v2.1.0
[1.0.0]: https://github.com/trust-delta/tmai/releases/tag/v2.0.0
