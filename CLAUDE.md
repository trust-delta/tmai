# tmai (Tmux Multi Agent Interface)

tmux上で複数のAIエージェント（Claude Code、Codex CLI、Gemini CLI）を監視・操作するためのRustツール。

## 解決する課題（tmuxccの問題点）

1. 確認ダイアログ（Do you want to make this edit?）を待機中と誤判定
2. `❯` を入力プロンプトと誤認識するバグ
3. AskUserQuestion非対応
4. プレビュー機能なし

## ディレクトリ構成

```
tmai/
├── Cargo.toml
├── CLAUDE.md
├── src/
│   ├── main.rs                 # エントリポイント、CLI
│   ├── lib.rs
│   ├── agents/                 # エージェント定義
│   │   ├── mod.rs
│   │   ├── types.rs            # AgentType, AgentStatus, ApprovalType
│   │   └── subagent.rs
│   ├── detectors/              # 状態検出（weztermcc方式）
│   │   ├── mod.rs              # StatusDetector trait
│   │   ├── claude_code.rs      # Claude Code専用検出器
│   │   ├── codex.rs
│   │   ├── gemini.rs
│   │   └── default.rs
│   ├── tmux/                   # tmux連携
│   │   ├── mod.rs
│   │   ├── client.rs           # tmux CLI wrapper
│   │   ├── pane.rs             # PaneInfo
│   │   └── process.rs          # プロセスキャッシュ
│   ├── monitor/
│   │   ├── mod.rs
│   │   └── poller.rs           # 非同期ポーリング
│   ├── state/
│   │   ├── mod.rs
│   │   └── store.rs            # AppState
│   ├── ui/
│   │   ├── mod.rs
│   │   ├── app.rs              # メインループ
│   │   ├── layout.rs
│   │   └── components/
│   │       ├── mod.rs
│   │       ├── session_list.rs
│   │       ├── pane_preview.rs
│   │       ├── status_bar.rs
│   │       ├── help_popup.rs
│   │       └── selection_popup.rs  # AskUserQuestion用
│   └── config/
│       ├── mod.rs
│       └── settings.rs
└── tests/
```

## 開発コマンド

```bash
cargo run              # 実行
cargo run -- --debug   # デバッグモード
cargo test             # テスト
cargo clippy           # Lint
cargo fmt              # フォーマット
cargo build --release  # リリースビルド
```

## 対応エージェント

| Agent | 検出方法 | 承認キー |
|-------|----------|----------|
| Claude Code | `claude` コマンド、✳/spinner in title | `y` / `n` |
| OpenCode | `opencode` コマンド | `y` / `n` |
| Codex CLI | `codex` コマンド | `y` / `n` |
| Gemini CLI | `gemini` コマンド | `y` / `n` |

## キーバインド

| キー | 動作 |
|------|------|
| j/k, ↓/↑ | ナビゲーション |
| y | 承認 |
| n | 拒否 |
| 1-9 | AskUserQuestion選択 |
| Space | 複数選択トグル |
| f | ペインにフォーカス |
| Enter | 折り畳みトグル |
| ? | ヘルプ |
| q | 終了 |
| Ctrl+d/u | プレビュースクロール |

## Claude Code検出器の設計

**検出優先度（3段階）：**
1. **Approval検出**（最高優先度）
   - AskUserQuestion（番号付き選択肢）
   - Yes/No ボタン形式（4行以内proximity check）
   - `[y/n]` パターン
2. **Error検出**
3. **Title-based検出**
   - `✳` = Idle
   - Braille spinners = Processing

**tmuxccバグ修正：**
- `❯` 単独行は選択カーソルとして認識（入力プロンプトと誤認識しない）
- Yes/No検出は行距離チェック付き
