# tmai (archived)

> **This repository is archived as of 2026-04-18.** Active development has moved to new repositories under the same owner.

## Where the work moved

| Repository | Visibility | Role |
|------------|-----------|------|
| [`trust-delta/tmai-core`](https://github.com/trust-delta/tmai-core) | private | Core engine — orchestration, agent detection, policy, all ongoing development |
| [`trust-delta/tmai-react`](https://github.com/trust-delta/tmai-react) | public | Standard React WebUI. Forkable, swappable with any UI that speaks the contract |
| [`trust-delta/tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec) | public | OpenAPI 3.1 spec + Redoc docs. The contract any UI uses to talk to `tmai-core` |

A Rust TUI (ratatui) client will be extracted to a separate public repo (`tmai-ratatui`) after the core finishes its HTTP/SSE client migration.

## Why the split

To protect ongoing orchestration and agent-state-detection work from AI-driven code reuse while keeping the UI layer fully open source. The contract between core and UI stays public — any third-party UI can integrate via [`tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec).

## For past contributors

Thanks to everyone who contributed here. Your commits remain in this repository's history. For new work:

- **UI improvements** → [`tmai-react`](https://github.com/trust-delta/tmai-react) (frontend) or a UI of your own against [`tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec)
- **Core changes / bug reports** → open an issue on [`tmai-core`](https://github.com/trust-delta/tmai-core) if you have access, or contact the maintainer

## Historical

This repo contains the full history of tmai development from its start through 2026-04-18. The last active commit before archiving was [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d). The crates.io `tmai-core` crate (versions up to `1.7.0`) remains published for backwards compatibility but will not receive further updates from this location.

## License

MIT — see [LICENSE](LICENSE).
