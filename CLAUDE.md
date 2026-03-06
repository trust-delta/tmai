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
  - `agents/` — エージェント型定義（AgentType, AgentStatus, DetectionSource）
  - `api/` — **Facade API**（TmaiCore struct）。TUI・Webの共通インターフェース
  - `audit/` — 検出監査ログ（ndjson形式、10MB rotation）
  - `auto_approve/` — 自動承認エンジン（Rules/AI/Hybrid/Off）
  - `command_sender.rs` — 統一コマンド送信（IPC優先、tmuxフォールバック）
  - `config/` — 設定（`~/.config/tmai/config.toml`）
  - `detectors/` — エージェント状態検出（プラガブル、エージェント種別ごと）
  - `git/` — Gitリポジトリ情報キャッシュ（ブランチ、dirty状態、worktree検出）
  - `hooks/` — **Claude Code Hooks連携**（HTTP hookイベント受信、状態管理）
  - `ipc/` — Unix domain socket通信（PTYラッパー ↔ 親プロセス）
  - `monitor/` — ポーリングループ（tokio async）
  - `security/` — セキュリティスキャナー（Claude Code設定・MCP設定の脆弱性検出）
  - `session_lookup/` — Claude Codeセッション ID逆引き（capture-pane → session JSONL照合）
  - `state/` — AppState（`Arc<RwLock<AppState>>`、parking_lot）
  - `review/` — **Fresh Session Review**（コンテキストフリーなコードレビュー自動起動）
  - `teams/` — Claude Code Agent Teams読み取り
  - `tmux/` — tmuxコマンド実行層
  - `usage/` — Claude Code API使用量取得・パース
  - `utils/` — 共通ユーティリティ
  - `wrap/` — PTYラッパー（IPC経由の状態検出用）

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
- **3段構え検出**（Detection Strategy）: 精度・信頼度の高い順にフォールバック
  1. **Hook**（推奨）: Claude Code Hooksからの HTTP POST イベント。最高精度。`tmai init` でセットアップ
  2. **IPC**: PTYラッパー経由の Unix domain socket 通信。`tmai wrap` で起動時に利用
  3. **capture-pane**: tmux capture-pane による画面テキスト解析。セットアップ不要のフォールバック
  - 検出ソースはUI上でアイコン表示: ◈=Hook, ◉=IPC, ○=capture-pane
- **Import規約**: core側は`use crate::`、bin側は`use tmai_core::`でcore参照、`use crate::`はdemo/ui/webのみ

### Initialization Flow (Normal Mode)

1. CLI引数パース → Settings読み込み
2. IPCサーバー起動
3. 監査イベントチャネル作成
4. `App`初期化
5. `CommandSender`作成（IPCサーバー連携）
6. Hook Registry・トークン読み込み
7. `TmaiCoreBuilder`でFacade構築
8. Webサーバー起動（設定有効時、Hook受信エンドポイント含む）
9. Auto-approveサービス起動（設定有効時）
10. ReviewService起動（設定有効時、AgentStopped → 自動レビュー）
11. `app.run()` でTUIイベントループ開始

## Known Limitations

### Passthrough Mode Cursor Position

プレビューペインはボーダー分（2列）実tmuxペインより狭いため、折り返し位置がずれてカーソル位置が一致しない。設計上の制約。緩和策: Tab/Shift+Tabで分割比率を調整、または`line_wrap = true`を設定。
