# tmai

**Tmux Multi Agent Interface** - tmux上で複数のAIエージェントを監視・操作するツール

![Rust](https://img.shields.io/badge/rust-1.70%2B-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

![tmai デモ](assets/tmai-demo.gif)

## 機能

- **マルチエージェント監視** - Claude Code、OpenCode、Codex CLI、Gemini CLIなど複数のAIエージェントをtmuxペイン上で一元監視
- **リアルタイムプレビュー** - ペインを切り替えずにエージェントの出力を確認（ANSIカラー対応）
- **クイック承認** - ツール呼び出しをワンキーで承認/拒否
- **AskUserQuestion対応** - 数字キーで選択肢を即座に選択（複数選択にも対応）
- **パススルーモード** - キー入力を直接エージェントペインに送信
- **自動状態検出** - Idle、Processing、承認待ちなどの状態を自動判定
- **PTYラッピング** - PTYプロキシによる高精度なリアルタイム状態検出
- **Web Remote Control** - スマホからQRコード経由で承認操作
- **Agent Teams** - Claude Code Agent Teamsのチーム構造・タスク進捗を可視化
- **モード検出** - Plan/Delegate/Auto-approveモードをタイトルアイコンから自動検出・表示

## インストール

```bash
cargo install tmai
```

または、ソースからビルド:

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo build --release
```

## 使い方

tmuxセッション内で `tmai` を実行:

```bash
tmai
```

### 設定

設定ファイルを以下のいずれかの場所に作成（最初に見つかったものが使用される）:

- `~/.config/tmai/config.toml`
- `~/.tmai.toml`

設定例:

```toml
poll_interval_ms = 500
passthrough_poll_interval_ms = 10
capture_lines = 100
attached_only = true

[ui]
show_preview = true
preview_height = 40
color = true

[web]
enabled = true
port = 9876

[teams]
enabled = true
scan_interval = 5
```

### キーバインド

| キー | 動作 |
|------|------|
| `j` / `k`、`↓` / `↑` | エージェント選択 |
| `y` | 承認 / Yesを選択 |
| `n` | Noを選択（UserQuestionのみ） |
| `1-9` | 番号で選択肢を選択 |
| `Space` | 複数選択トグル |
| `i` | 入力モード |
| `p` / `→` | パススルーモード |
| `f` | ペインにフォーカス |
| `x` | ペインを終了（確認あり） |
| `Tab` | ビューモード切り替え（Split/List/Preview） |
| `l` | 分割方向切り替え（横/縦） |
| `t` | タスクオーバーレイ（チームメンバー選択時） |
| `T` | チーム一覧画面 |
| `r` | Web RemoteのQRコード表示 |
| `?` | ヘルプ |
| `Esc` / `q` | 終了 |
| `Ctrl+d` / `Ctrl+u` | プレビュースクロール |

### モード

- **ノーマルモード** - ナビゲーションとクイックアクション
- **入力モード** (`i`) - テキストを入力してエージェントに送信
- **パススルーモード** (`→`) - キーを直接ペインに送信

## PTYラッピング

より正確な状態検出のため、AIエージェントをPTYプロキシでラップして起動できます:

```bash
# Claude CodeをPTYラッピングで起動
tmai wrap claude

# 引数付き
tmai wrap "claude --dangerously-skip-permissions"

# 他のエージェント
tmai wrap codex
tmai wrap gemini
```

メリット:
- **リアルタイムI/O監視** - 状態変化を即座に検出
- **ポーリング遅延なし** - tmux capture-paneより高速
- **高精度な承認検出** - Yes/NoやAskUserQuestionを確実に検出

tmai UIから新規AIプロセスを作成すると、自動的にラップされます。

## Web Remote Control

スマホからAIエージェントを操作:

1. `r`キーでQRコードを表示
2. スマホでスキャン
3. Webインターフェースで承認/拒否、選択肢の選択

### WSL2での設定

#### Mirrored mode（推奨）

`.wslconfig`に`networkingMode=mirrored`が設定されている場合、Windowsファイアウォールでポートを許可するだけでOK:

```powershell
# 管理者権限のPowerShellで実行
New-NetFirewallRule -DisplayName "tmai Web Remote" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow
```

#### NAT mode（従来方式）

mirrored modeを使用していない場合、ポートフォワーディングが必要です:

```powershell
# 管理者権限のPowerShellで実行
.\scripts\setup-wsl-portforward.ps1

# 削除する場合
.\scripts\setup-wsl-portforward.ps1 -Remove
```

**注意**: NAT modeではWSLのIPがリブートで変わるため、接続できなくなったら再度スクリプトを実行してください。

## 対応エージェント

| エージェント | 検出 | PTYラップ |
|--------------|------|-----------|
| Claude Code | ✅ 対応 | ✅ |
| OpenCode | ✅ 対応 | ✅ |
| Codex CLI | ✅ 対応 | ✅ |
| Gemini CLI | ✅ 対応 | ✅ |

## スクリーンショット

```
┌─────────────────┬─────────────────────────────────┐
│ Sessions        │ Preview                         │
│                 │                                 │
│ ● main:0.0      │ Do you want to make this edit?  │
│   Claude Code   │                                 │
│   ⠋ Processing  │ ❯ 1. Yes                        │
│                 │   2. Yes, allow all...          │
│ ○ main:0.1      │   3. No                         │
│   Claude Code   │                                 │
│   ✳ Idle        │                                 │
└─────────────────┴─────────────────────────────────┘
 j/k:Nav 1-9:Select i:Input →:Direct ?:Help q:Quit
```

## 開発

```bash
cargo run              # 実行
cargo run -- --debug   # デバッグモード
cargo test             # テスト
cargo clippy           # Lint
cargo fmt              # フォーマット
```

## 謝辞

[tmuxcc](https://github.com/nyanko3141592/tmuxcc) にインスピレーションを受けました。

## ライセンス

MIT
