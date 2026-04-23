# tmai へのコントリビューション

コントリビューションに興味を持っていただきありがとうございます。本リポジトリは **tmai の monorepo + release hub** であり、UI、ワイヤー契約、installer、リリースパイプラインすべてここにあります。これらに対する issue / PR は本リポジトリに直接提出してください。エンジン関連の作業のみが private の [`tmai-core`](https://github.com/trust-delta/tmai-core) で行われます。

> **English version**: [CONTRIBUTING.md](./CONTRIBUTING.md)

## コントリビュート先

| 変更領域 | 場所 |
|----------|------|
| React WebUI | `clients/react/` (本リポジトリ) |
| Ratatui TUI クライアント | `clients/ratatui/` (本リポジトリ) |
| ワイヤー契約 — REST エンドポイント / CoreEvent variants / error taxonomy | `api-spec/` (本リポジトリ、生成物 — 編集は [`tmai-core`](https://github.com/trust-delta/tmai-core) 側から bot PR 経由で反映、手編集は CI が reject) |
| Installer / release workflow / bundle version pin | `install.sh` / `.github/workflows/` / `versions.toml` (本リポジトリ) |
| ドキュメント / ランディング / スクリーンショット | `README.md` / `README.ja.md` / `CHANGELOG.md` / `assets/` (本リポジトリ) |
| サーバーロジック / オーケストレーション / MCP / HTTP / SSE 実装 | private の [`tmai-core`](https://github.com/trust-delta/tmai-core) (collaborator 権限必要) |

旧 sub-repo (`tmai-api-spec`、`tmai-react`、`tmai-ratatui`) は 2026-04-23 に archive 済です — そちらへの issue / PR 提出は控えてください。

## この hub repo が受け付ける変更

- `clients/react/` — React WebUI のソースとテスト
- `clients/ratatui/` — ratatui クライアントのソースとテスト
- `api-spec/` — 生成済 OpenAPI + JSON Schema + MCP snapshot (手編集は CI が reject、ジェネレーターは `tmai-core` 側)
- `.github/workflows/` — release / validation / pages workflow
- `install.sh` — curl-pipeable installer
- `versions.toml` — `release.yml` が読む bundle バージョン pin
- `README.md` / `README.ja.md` / `CHANGELOG.md` / `LICENSE` / `assets/` — ランディング / ドキュメント / メディア

## Issue

上記リストの領域は本リポジトリに issue を提出してください。エンジン側のバグでも、まず本リポジトリに issue を立てていただければ再現・triage し、必要に応じてエンジン側へ引き継ぎます。

## 言語

Issues / Discussions は英語・日本語どちらでも構いません。
