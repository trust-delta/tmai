# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

tmai (Tmux Multi Agents Interface) — tmux上で複数のAIエージェント（Claude Code、Codex CLI、Gemini CLI）を監視・操作するためのRust TUIツール。

## Development Commands

```bash
cargo run                     # 実行
cargo run -- --debug          # デバッグモード
cargo run -- --audit          # 検出監査ログ有効
cargo run -- wrap claude      # PTYラップモードでclaude起動
cargo run -- demo             # デモモード（tmux不要）
cargo test                    # 全テスト
cargo test -p tmai-core       # coreクレートのみテスト
cargo test <test_name>        # 単一テスト実行
cargo clippy -- -D warnings   # Lint（CI同等、warnings禁止）
cargo fmt                     # フォーマット
cargo fmt --check             # フォーマットチェック（CI同等）
```

## Branch Strategy

- **作業開始時に `fix/xxx` or `feat/xxx` ブランチを切る**（main への直接コミット禁止）
- 都度コミット、PR は squash merge
- **バージョンバンプは main に直接コミット**（例外。PRは作らない。CIはタグpush時のpublishで担保）
- `release/` ブランチは使わない

## Architecture

### Workspace Structure

2クレート構成のCargo workspace:

- **`crates/tmai-core/`** (lib crate) — ビジネスロジック全体
  - `agents/` — エージェント型定義（AgentType, AgentStatus, AgentMode）
  - `api/` — **Facade API**（TmaiCore struct）。TUI・Webの共通インターフェース
  - `audit/` — 検出監査ログ（ndjson形式、10MB rotation）
  - `auto_approve/` — 自動承認エンジン（Rules/AI/Hybrid/Off）
  - `command_sender.rs` — 統一コマンド送信（IPC優先、tmuxフォールバック）
  - `config/` — 設定（`~/.config/tmai/config.toml`）
  - `detectors/` — エージェント状態検出（プラガブル、エージェント種別ごと）
  - `ipc/` — Unix domain socket通信（PTYラッパー ↔ 親プロセス）
  - `monitor/` — ポーリングループ（tokio async）
  - `state/` — AppState（`Arc<RwLock<AppState>>`、parking_lot）
  - `teams/` — Claude Code Agent Teams読み取り
  - `tmux/` — tmuxコマンド実行層
  - `wrap/` — PTYラッパー（高精度状態検出用）

- **`src/`** (bin crate) — フロントエンド
  - `ui/` — TUI（ratatui）、`ui/components/`にWidget群
  - `web/` — Webサーバー（axum + SSE）
  - `demo/` — デモモード
  - `main.rs` — エントリーポイント

### Key Patterns

- **SharedState**: `Arc<RwLock<AppState>>`（parking_lot）でスレッド間共有
- **Facade API**: `TmaiCore`がすべてのサービスを隠蔽。`TmaiCoreBuilder`で構築
  - Query: `list_agents()`, `get_agent()`, `get_preview()`等
  - Action: `approve()`, `send_text()`, `send_key()`等
  - Event: `subscribe()` → `broadcast::Receiver<CoreEvent>`
- **Owned Snapshots**: API戻り値は`AgentSnapshot`等のOwned型（ロック不要）
- **IPC**: `/tmp/tmai/control.sock`でPTYラッパーと通信（ndjsonプロトコル）
- **Detection Strategy**: エージェント種別ごとのプラガブル検出器（`DetectionResult` + `DetectionReason`）
- **Import規約**: core側は`use crate::`、bin側は`use tmai_core::`でcore参照、`use crate::`はdemo/ui/webのみ

### Initialization Flow (Normal Mode)

1. CLI引数パース → Settings読み込み
2. IPCサーバー起動
3. `App`初期化
4. `TmaiCoreBuilder`でFacade構築
5. Webサーバー起動（設定有効時）
6. Auto-approveサービス起動（設定有効時）
7. `app.run()` でTUIイベントループ開始

## Issues / TODO

### Passthrough Mode Cursor Position

tmuxペインとプレビューの幅が異なり、折り返し位置がずれてカーソル位置が一致しない。

### Focus to Another Session (`f` key)

`switch-client`を使うとtmai自体のクライアントが切り替わる問題（SSH経由で顕著）。

## Known Bugs

### wezTerm SSH Domain: New AI Session Creation

`wezterm cli spawn`が2ペイン構成になる。回避策: 空シェルペインを手動で閉じる。
該当: `crates/tmai-core/src/tmux/client.rs` の `open_session_in_wezterm_tab()`
