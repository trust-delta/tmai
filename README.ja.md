# tmai

**Tmux Multi Agent Interface** - tmux上で複数のAIエージェントを監視・操作するツール

![Rust](https://img.shields.io/badge/rust-1.91%2B-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

![tmai デモ](assets/tmai-demo.gif)

## 機能

- **マルチエージェント監視** - Claude Code、OpenCode、Codex CLI、Gemini CLIなど複数のAIエージェントをtmuxペイン上で一元監視
- **リアルタイムプレビュー** - ペインを切り替えずにエージェントの出力を確認（ANSIカラー対応）
- **クイック承認** - ツール呼び出しをワンキーで承認/拒否
- **AskUserQuestion対応** - 数字キーで選択肢を即座に選択（複数選択にも対応）
- **パススルーモード** - キー入力を直接エージェントペインに送信
- **自動状態検出** - Idle、Processing、承認待ちなどの状態を自動判定
- **Claude Code Hooks** - HTTP hookによるイベント駆動の状態検出（`tmai init`でセットアップ）
- **PTYラッピング** - PTYプロキシによるリアルタイムI/O監視・Exfil検出
- **Exfil検出** - 外部へのデータ送信をセキュリティ監視
- **Web Remote Control** - スマホからQRコード経由で承認操作
- **Agent Teams** - Claude Code Agent Teamsのチーム構造・タスク進捗を可視化
- **モード検出** - Plan/Delegate/Auto-approveモードをタイトルアイコンから自動検出・表示
- **Auto-approve** - Off/ルールベース/AI/ハイブリッドの4モードで安全な操作を自動承認
- **使用量モニタリング** - `U`キーでClaudeサブスクリプションの使用状況（5時間セッション/週次制限）を確認

## ドキュメント

詳しいガイドやワークフローは [doc/](./doc/README.md) を参照:

- [はじめに](./doc/ja/getting-started.md) - インストールと初期設定
- [Claude Code Hooks](./doc/ja/features/hooks.md) - HTTP hookによるイベント駆動検出
- [マルチエージェント監視](./doc/ja/workflows/multi-agent.md) - 複数エージェントの同時監視
- [Worktree並列開発](./doc/ja/workflows/worktree-parallel.md) - Git worktreeワークフロー
- [tmaiの強み](./doc/ja/guides/strengths.md) - tmaiのユニークな特徴
- [Agent Teams](./doc/ja/features/agent-teams.md) - Claude Codeチームの監視
- [Auto-Approve](./doc/ja/features/auto-approve.md) - 4モードの自動承認（Rules/AI/Hybrid/Off）

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

## クイックスタート

### 1. Hooksセットアップ（推奨・初回のみ）

```bash
tmai init
```

Claude Codeがリアルタイムでイベントをtmaiに送信するように設定します。高精度な状態検出が可能になります。

### 2. tmaiを起動

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

[usage]
auto_refresh_min = 15       # 0 = 手動のみ（デフォルト）

[auto_approve]
mode = "hybrid"             # off/rules/ai/hybrid
model = "haiku"
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
| `W` | 非IPCエージェントをIPC化再起動（Claude Codeのみ） |
| `U` | 使用量確認（Claude Max/Pro） |
| `?` | ヘルプ |
| `Esc` / `q` | 終了 |
| `Ctrl+d` / `Ctrl+u` | プレビュースクロール |

### モード

- **ノーマルモード** - ナビゲーションとクイックアクション
- **入力モード** (`i`) - テキストを入力してエージェントに送信
- **パススルーモード** (`→`) - キーを直接ペインに送信

## PTYラッピング（オプション）

Exfil検出やAskUserQuestionの完全パースなど、Hooks以上の追加機能が必要な場合にPTYプロキシでラップできます:

```bash
# Claude CodeをPTYラッピングで起動
tmai wrap claude

# 引数付き
tmai wrap "claude --dangerously-skip-permissions"

# 他のエージェント
tmai wrap codex
tmai wrap gemini
```

Hooks に加えて得られるメリット:
- **Exfil検出** - 外部へのデータ送信を監視
- **AskUserQuestion完全パース** - 選択肢テキストを解析して直接選択
- **リアルタイムI/O監視** - I/Oストリームの直接解析

tmai UIから新規AIプロセスを作成すると、自動的にラップされます。

## Web Remote Control

スマホからAIエージェントを操作:

1. `r`キーでQRコードを表示
2. スマホでスキャン
3. Webインターフェースで承認/拒否、選択肢の選択

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="Web Remote - エージェント一覧" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="Web Remote - AskUserQuestion" width="280">
</p>

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

| エージェント | 検出 | Hooks | PTYラップ |
|--------------|------|-------|-----------|
| Claude Code | ✅ 対応 | ✅ | ✅ |
| OpenCode | ✅ 対応 | — | ✅ |
| Codex CLI | ✅ 対応 | — | ✅ |
| Gemini CLI | ✅ 対応 | — | ✅ |

## 使用量モニタリング

`U`キーでClaudeサブスクリプションの使用状況を確認できます。バックグラウンドで一時的なClaude Codeインスタンスを起動し、`/usage`コマンドを実行して結果を表示します。

<p align="center">
  <img src="assets/usage-view.png" alt="使用量モニタリング" width="600">
</p>

## スクリーンショット

```
┌─────────────────┬─────────────────────────────────┐
│ Sessions        │ Preview                         │
│                 │                                 │
│ [◈Hook] main:0  │ Do you want to make this edit?  │
│   Claude Code   │                                 │
│   ⠋ Processing  │ ❯ 1. Yes                        │
│                 │   2. Yes, allow all...          │
│ [IPC] main:0.1  │   3. No                         │
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

## コントリビューション

[CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md) をご覧ください。

## ライセンス

MIT
