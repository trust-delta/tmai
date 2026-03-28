# Getting Started

tmaiのインストールから最初の監視までのガイド。

## 必要なもの

- Rust toolchain (1.70+)
- ChromeまたはChromium（WebUI App Mode用 — 自動検出）
- 監視したいAIエージェント（Claude Code、Codex CLI、Gemini CLI等）
- tmux（オプション、`--tmux` TUIモードのみ必要）

## インストール

### crates.ioからインストール

```bash
cargo install tmai
```

### ソースからビルド

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo build --release

# パスの通った場所にコピー
cp target/release/tmai ~/.local/bin/
```

## クイックスタート（WebUIモード）

### 1. hooksをセットアップ（推奨、初回のみ）

```bash
tmai init
```

`~/.claude/settings.json` にtmaiをHTTP hookの受信先として登録します。すべてのClaude Codeセッションが自動的にtmaiに状態イベントを送信します。

### 2. tmaiを起動

```bash
tmai
```

tmaiがウェブサーバーを起動し、Chrome App Modeを自動的に開きます。ダッシュボードに検出されたすべてのAIエージェントが表示されます。

<!-- screenshot: webui-first-launch.png -->

### 3. AIエージェントを起動

ターミナルを開いてAIエージェントを起動します：

```bash
claude
```

tmaiがhooks経由でエージェントを自動検出し、ダッシュボードに表示します。WebUIから離れることなく、承認、入力送信、操作が可能です。

### 4. 監視・操作

WebUIダッシュボードでは：

- **サイドバー** — プロジェクト別にグループ化された全検出エージェント一覧
- **エージェントビュー** — エージェントのステータス、承認ボタン、テキスト入力
- **ターミナル** — xterm.jsによるフルインタラクティブターミナル
- **ブランチグラフ** — ブランチ可視化付きGitコミット履歴
- **GitHub** — PRステータス、CIチェック、Issue

## TUIモード（オプション）

tmuxパワーユーザー向けに、ターミナルUIもサポートしています：

```bash
# tmuxが必要 — tmuxペイン内でtmaiを起動
tmai --tmux
```

| キー | 動作 |
|------|------|
| `j/k` | エージェント選択 |
| `y` | 承認（Enterを送信） |
| `1-9` | AskUserQuestionの選択肢を選択 |
| `i` | 入力モード |
| `->` | パススルーモード |
| `?` | ヘルプ表示 |

## Claude Code Hooks連携（推奨）

最高精度の状態検出のため、Claude Code Hooksをセットアップします：

```bash
# 初回セットアップ: Claude Codeにhooksを設定
tmai init
```

メリット：
- イベント駆動型の状態検出（最高精度）
- 通常の `claude` コマンドで動作（ラッパー不要）
- ゼロレイテンシのイベント配信
- WebUIとTUIの両モードで動作

## PTYラッピングモード（オプション）

外部送信検知やAskUserQuestionの完全な解析が必要な場合は、PTYラッピングで起動：

```bash
# PTYラッピングでClaudeを起動
tmai wrap claude
```

hooksに加えて得られるメリット：
- 外部送信検知が有効
- AskUserQuestionの選択肢を完全に解析
- I/Oの直接監視

> **Note**: HooksとPTYラッピングは併用可能です。両方が有効な場合、状態検出にはhooksが優先されます。

## デモモード

tmuxやエージェントなしでtmaiを試す：

```bash
tmai demo
```

## 次のステップ

- [WebUI概要](./features/webui-overview.md) - ダッシュボードのレイアウトと機能
- [ブランチグラフ](./features/branch-graph.md) - Git可視化
- [GitHub連携](./features/github-integration.md) - PRとCI監視
- [Claude Code Hooks連携](./features/hooks.md) - Hooksの詳細ドキュメント
- [マルチエージェント監視](./workflows/multi-agent.md) - 複数エージェントを同時に監視
- [Agent Teams](./features/agent-teams.md) - Claude Codeチーム監視
- [tmaiの強み](./guides/strengths.md) - tmaiが得意なこと
