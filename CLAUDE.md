# tmai (Tmux Multi Agent Interface)

tmux上で複数のAIエージェント（Claude Code、Codex CLI、Gemini CLI）を監視・操作するためのRustツール。

## ミッション

AIエージェントのターミナル操作を効率化する。複数エージェントの状態（Processing/Idle/Approval待ち）を自動検出し、承認操作・リモート操作を一画面で提供。

## ターゲットユーザー

AIエージェントを複数並行で使う開発者。tmux上で動作し、スマホからの遠隔操作にも対応。

## アーキテクチャ

```
tmai (TUI/Web)
├── Poller (500ms周期) ─── 状態検出 ─┬─ IPC (PTY wrap経由、高精度)
│                                     └─ capture-pane (従来方式)
├── UI (ratatui) ─── キー入力 → tmux send-keys
├── Web (axum) ─── REST API + SSE → スマホ操作
├── Auto-approve ─── Rules/AI/Hybrid → 自動承認
└── Teams ─── ~/.claude/teams/ 読み込み → チーム可視化
```

## ディレクトリ構成

Cargo workspace: `tmai-core` (lib) + `tmai` (bin)

```
tmai/                          # workspace root
├── Cargo.toml                 # [workspace] + bin crate
├── crates/
│   └── tmai-core/             # コアライブラリ（ビジネスロジック）
│       └── src/
│           ├── agents/        # AgentType, AgentStatus, ApprovalType, DetectionSource
│           ├── audit/         # 検出監査ログ（ndjson形式）
│           ├── auto_approve/  # 自動承認（Off/Rules/AI/Hybrid 4モード）
│           ├── command_sender.rs
│           ├── config/        # ~/.config/tmai/config.toml パーサー
│           ├── detectors/     # 状態検出器（Claude Code/Codex/Gemini/Default）
│           ├── git/           # Git情報
│           ├── ipc/           # IPC通信
│           ├── monitor/       # 非同期ポーリング
│           ├── session_lookup/# セッションID逆引き（IPC化再起動用）
│           ├── state/         # AppState（SharedState = Arc<RwLock<AppState>>）
│           ├── teams/         # Agent Teams検出（~/.claude/teams/）
│           ├── tmux/          # tmux CLI wrapper
│           ├── utils/
│           └── wrap/          # PTYラッピング（入出力プロキシ + 状態解析）
└── src/                       # bin crate（フロントエンド）
    ├── main.rs
    ├── lib.rs                 # demo, ui, web のみ
    ├── demo/
    ├── ui/                    # TUI（app.rs + components/）
    └── web/                   # Web Remote Control（axum + SSE）
```

## 開発コマンド

```bash
cargo run                     # 実行
cargo run -- --debug          # デバッグモード
cargo run -- --audit          # 検出監査ログ有効
cargo run -- wrap claude      # PTYラップモードでclaude起動
cargo test                    # テスト
cargo clippy                  # Lint
cargo fmt                     # フォーマット
```

## 対応エージェント

| Agent | 検出方法 | 承認キー |
|-------|----------|----------|
| Claude Code | `claude` コマンド、タイトルのスピナー/✳ | `y` |
| OpenCode | `opencode` コマンド | `y` |
| Codex CLI | `codex` コマンド | `y` |
| Gemini CLI | `gemini` コマンド | `y` |

## 主要機能（詳細は doc/ 参照）

| 機能 | ドキュメント | ソース |
|------|------------|--------|
| キーバインド | `doc/reference/keybindings.md` | `src/ui/components/help_screen.rs` |
| 設定リファレンス | `doc/reference/config.md` | `crates/tmai-core/src/config/settings.rs` |
| Web API | `doc/reference/web-api.md` | `src/web/api.rs` |
| PTYラッピング | `doc/features/pty-wrapping.md` | `crates/tmai-core/src/wrap/` |
| Web Remote | `doc/features/web-remote.md` | `src/web/` |
| Auto-approve | `doc/features/auto-approve.md` | `crates/tmai-core/src/auto_approve/` |
| Agent Teams | `doc/features/agent-teams.md` | `crates/tmai-core/src/teams/` |
| Exfil Detection | `doc/features/exfil-detection.md` | `crates/tmai-core/src/wrap/exfil_detector.rs` |
| AskUserQuestion | `doc/features/ask-user-question.md` | `crates/tmai-core/src/detectors/claude_code.rs` |

## ドメイン知識

### 検出の仕組み

状態検出は2系統あり、IPCが優先される:

- **IPC（PTY wrap経由）**: `tmai wrap claude` で起動したエージェントの入出力を直接解析。高精度
- **capture-pane**: 手動起動されたエージェントのtmux画面テキストを解析。フォールバック

### モード検出（タイトルアイコン）

| アイコン | モード |
|---------|--------|
| ⏸ | Plan |
| ⇢ | Delegate |
| ⏵⏵ | AutoApprove |

### 状態ファイル

PTY wrap時の状態共有: `$XDG_RUNTIME_DIR/tmai/{pane_id}.state`（JSON）
フォーマットは `src/wrap/state_file.rs` の `WrapState` struct を参照。

## 課題・TODO

### パススルーモードでのカーソル位置表示
tmuxペインとプレビューの幅が異なり、折り返し位置がずれてカーソル位置が一致しない。

### fキーで別セッションへのフォーカス
`switch-client` を使うとtmai自体のクライアントが切り替わる問題（SSH経由で顕著）。

## 既知の不具合

### wezTerm SSH domain環境での新規AIセッション作成
`wezterm cli spawn` が2ペイン構成になる。回避策: 空シェルペインを手動で閉じる。
該当: `src/tmux/client.rs` の `open_session_in_wezterm_tab()`
