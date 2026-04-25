# Security Policy

> **日本語版**: [SECURITY.ja.md](./SECURITY.ja.md)

## Reporting a vulnerability

Please use GitHub's **Private Vulnerability Reporting** on this repository:

> https://github.com/trust-delta/tmai/security/advisories/new

Do **not** open a public issue, discussion, or pull request for security reports — this prevents accidental disclosure before a fix is available.

If you cannot use GitHub's reporting flow, you can email the maintainer at the address shown on the [tmai org page](https://github.com/trust-delta).

We will:

- Acknowledge your report within **3 business days**.
- Share a triage outcome (accepted / needs more info / out of scope) within **7 business days**.
- Coordinate disclosure timing with you, and credit you in the resulting GitHub Security Advisory unless you ask otherwise.

## Scope

This repository (`trust-delta/tmai`) is the public monorepo and release hub. Reports about any of the following belong here:

- React WebUI (`clients/react/`)
- Ratatui TUI (`clients/ratatui/`)
- Wire contract (`api-spec/` — generated from `tmai-core`)
- Installer (`install.sh`) and release workflow (`.github/workflows/`)
- Released binaries / bundle tarballs published from this repo

The engine itself (`tmai`, `tmai-core`) is developed in a separate private repository. Engine-side reports may still be filed here — we will reproduce, triage, and coordinate disclosure across both repos.

### Out of scope

- Vulnerabilities in third-party dependencies that have not been triaged upstream — please report to the upstream project first; we'll happily track the resulting advisory.
- Findings that require an attacker who already has shell access on the host running `tmai`. (`tmai` orchestrates local AI agents and intentionally trusts the local user.)
- Self-XSS, clickjacking on pages without authenticated state, or social-engineering reports without a defect in this codebase.
- Reports against archived sub-repos (`tmai-api-spec`, `tmai-react`, `tmai-ratatui`) — file against `trust-delta/tmai` instead.

## Supported versions

We support the **latest release** on the [Releases page](https://github.com/trust-delta/tmai/releases). Older releases are not patched; please upgrade.

## Security tooling in this repository

- **GitHub Secret Scanning** + **Push Protection** — enabled.
- **CodeQL** — default setup, runs on push and pull request.
- **Dependabot** — weekly version updates for npm (`clients/react/`, `api-spec/`), cargo (`clients/ratatui/`), and GitHub Actions, plus automatic security PRs for known advisories.
- **Private Vulnerability Reporting** — enabled.
