# tmai

**Tactful Multi Agent Interface** — 複数の AI コーディングエージェント (Claude Code、Codex CLI、OpenCode、Gemini CLI) を統合エンジンと差し替え可能な UI でオーケストレーションする。

![License](https://img.shields.io/badge/license-MIT-blue)
![Status](https://img.shields.io/badge/status-active-brightgreen)

> **English version**: [README.md](./README.md)

<p align="center">
  <img src="assets/tmai-demo.gif" alt="tmai demo" width="720">
</p>

> **このリポジトリは tmai の monorepo + release hub です。** UI (`clients/react/`、`clients/ratatui/`)、ワイヤー契約 (`api-spec/`)、installer、リリースパイプラインはここに、エンジン実装のみが private の [`tmai-core`](https://github.com/trust-delta/tmai-core) にあります。

## 構成

| Repo | 可視性 | 役割 |
|------|--------|------|
| `trust-delta/tmai` (本リポジトリ) | public | release hub + monorepo。React WebUI (`clients/react/`)、ratatui TUI (`clients/ratatui/`)、ワイヤー契約 (`api-spec/`)、installer、ドキュメントを保持。bundle tarball を配布。 |
| [`tmai-core`](https://github.com/trust-delta/tmai-core) | private | コアエンジン — オーケストレーション / エージェント検出 / policy / MCP ホスト / HTTP/SSE サーバー。`core-v*` Release で target 毎のバイナリを供給し、生成物の spec / types は bot PR 経由で本リポジトリへ流入。 |
| `tmai-api-spec` / `tmai-react` / `tmai-ratatui` | archive | 履歴保全のみ。内容は 2026-04-23 に本リポジトリへ統合済。 |

## インストール

対応プラットフォームのバンドル tarball は本 repo の [Releases](https://github.com/trust-delta/tmai/releases) に添付されます。install スクリプトがプラットフォームを自動判定し、SHA-256 を検証してから prefix 以下に展開します:

```bash
# 最新リリースを $HOME/.local (デフォルト prefix) に:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash

# バージョンと prefix を指定:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh \
  | bash -s -- --version 2.0.0 --prefix /usr/local
```

展開先:

```
$PREFIX/bin/tmai
$PREFIX/bin/tmai-ratatui
$PREFIX/share/tmai/webui/       # tmai が binary 相対 fallback で自動配信
$PREFIX/share/tmai/api-spec/    # OpenAPI + CoreEvent JSON Schema リファレンス
```

対応プラットフォーム: Linux x86_64、Linux aarch64、macOS arm64。他のプラットフォームは [`tmai-core`](https://github.com/trust-delta/tmai-core) でのソースビルド (リポジトリ権限が必要)。

## クイックスタート

```bash
# 初回セットアップ: ~/.claude/settings.json に HTTP hook receiver を登録
tmai init

# 運用ダッシュボード TUI + API サーバーを起動
tmai
```

ダッシュボードはエンジンの稼働状況を表示し、`~/.config/tmai/config.toml` に登録した UI クライアントを起動します:

```toml
[[ui]]
name = "tmai-react"
path = "~/src/tmai-react"
launch = "pnpm dev"
port = 1420
default = true
```

## 機能

- **マルチエージェント監視** — Claude Code、Codex CLI、OpenCode、Gemini CLI
- **3 段構え状態検出** — HTTP Hooks (イベント駆動) → IPC/PTY wrap → tmux `capture-pane` フォールバック
- **Auto-approve エンジン** — rules / AI / hybrid / off
- **Orchestrator agent** — ロールベース dispatch と workflow-rule 合成
- **MCP サーバー** — 22+ ツールで他エージェントを stdio JSON-RPC 2.0 経由でオーケストレーション
- **ダッシュボード TUI** — エンジン健全性、アクティビティ、検出状態、UI registry、ログを `tmai` デフォルトモードで表示
- **差し替え可能な UI** — `tmai-react` (WebUI)、`tmai-ratatui` (TUI)、または [ワイヤー契約](https://github.com/trust-delta/tmai-api-spec) を話す任意のサードパーティクライアント
- **Agent Teams** — Claude Code のチーム検出とタスク進捗トラッキング
- **Git 面** — ブランチグラフ、worktree CRUD、`gh` 経由の PR/CI/issue 連携

## 契約

UI は [`api-spec/`](./api-spec/) で規定された 3 つの標準サーフェスで統合されます:

1. **HTTP REST** — `/api/*`
2. **SSE イベントストリーム** — `/api/events`
3. **MCP** (stdio JSON-RPC 2.0) — `tmai mcp`

spec はエンジン (`core`) バージョンとは独立した SemVer に従います。forward-compatible: UI は未知のイベント variant と optional フィールドを許容する必要があります。

## スクリーンショット

<p align="center">
  <img src="assets/usage-view.png" alt="Usage tracking" width="720">
</p>

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="モバイルリモート — エージェント一覧" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="モバイルリモート — AskUserQuestion" width="280">
</p>

## コントリビューション

UI / 契約 / ドキュメント / パッケージング変更は本リポジトリに直接 issue / PR を提出してください:

- **React WebUI** → `clients/react/`
- **Ratatui クライアント** → `clients/ratatui/`
- **ワイヤー契約** (REST エンドポイント、CoreEvent variants、error taxonomy) → `api-spec/` (生成物 — 編集は [`tmai-core`](https://github.com/trust-delta/tmai-core) 側から bot PR 経由で反映)
- **Installer / release workflow / docs** → ルート

エンジン関連の変更 (オーケストレーション、MCP ホスト、HTTP/SSE 実装) は private の [`tmai-core`](https://github.com/trust-delta/tmai-core) で行います。エンジン側で変更が必要な場合は本リポジトリに issue を立てていただければ triage します。

旧 sub-repo (`tmai-api-spec`、`tmai-react`、`tmai-ratatui`) は 2026-04-23 に archive 済です — そちらへの issue / PR 提出は控えてください。

setup と PR 規約は [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。

## 履歴

tmai は当初単一の monorepo として始まり (2026-04-18 まで)、一時的に 4 つのリポジトリ ([`tmai-core`](https://github.com/trust-delta/tmai-core) + `tmai-api-spec` / `tmai-react` / `tmai-ratatui`) に分割されました。2026-04-21 に UI 層と契約を本リポジトリの `clients/` / `api-spec/` 配下へ再統合、旧 3 sub-repo は 2026-04-23 に archive されました。split 直前の最終コミットは [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d)、再統合は [`v2.0.0`](https://github.com/trust-delta/tmai/releases/tag/v2.0.0) で配布されました。

crates.io の `tmai` クレートは `1.7.1` で deprecation (installer へ誘導するスタブ)。`1.7.0` は yank されず pin 済ユーザー向けに残りますが、`cargo install tmai` ではこれ以上新バイナリが配布されません — 上の `curl | bash` installer を使用してください。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。
