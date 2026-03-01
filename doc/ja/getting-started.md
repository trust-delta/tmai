# Getting Started

tmaiのインストールから最初の監視までのガイド。

## 必要なもの

- Rust toolchain (1.70+)
- tmux
- 監視したいAIエージェント（Claude Code、Codex CLI、Gemini CLI等）

## インストール

### crates.ioからインストール

```bash
cargo install tmai
```

### ソースからビルド

```bash
git clone https://github.com/your-username/tmai.git
cd tmai
cargo build --release

# パスの通った場所にコピー
cp target/release/tmai ~/.local/bin/
```

## 基本的な使い方

### 1. AIエージェントを起動

まず、tmux上でAIエージェントを起動します。

```bash
# tmuxセッションを作成
tmux new-session -s dev

# Claude Codeを起動
claude
```

### 2. tmaiを起動

別のペインまたはウィンドウでtmaiを起動します。

```bash
# 別ペインを開く
# Ctrl+b % (横分割) または Ctrl+b " (縦分割)

# tmaiを起動
tmai
```

tmaiが自動的にtmux内のAIエージェントを検出し、監視を開始します。

### 3. 監視・操作

| キー | 動作 |
|------|------|
| `j/k` | エージェント選択 |
| `y` | 承認（Enterを送信） |
| `1-9` | AskUserQuestionの選択肢を選択 |
| `p` | パススルーモード（直接入力） |
| `?` | ヘルプ表示 |
| `q` | 終了 |

> **Note**: 拒否やその他の選択は、数字キー、入力モード(`i`)、パススルーモード(`p`)を使用してください。

## Claude Code Hooks連携（推奨）

100%正確な状態検出のため、Claude Code Hooksをセットアップします：

```bash
# 初回セットアップ: Claude Codeにhooksを設定
tmai init
```

`~/.claude/settings.json` にtmaiをHTTP hookの受信先として登録します。セットアップ後は、すべてのClaude Codeセッションが自動的にtmaiに状態イベントを送信します。特別な起動コマンドは不要です。

メリット：
- 100%正確な状態検出
- 通常の `claude` コマンドで動作（ラッパー不要）
- ゼロレイテンシのイベント配信
- 既存セッションでも動作

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

## 次のステップ

- [Claude Code Hooks連携](./features/hooks.md) - Hooksの詳細ドキュメント
- [マルチエージェント監視](./workflows/multi-agent.md) - 複数エージェントを同時に監視
- [Agent Teams](./features/agent-teams.md) - Claude Codeチーム監視
- [ワークツリーで並列開発](./workflows/worktree-parallel.md) - 並列開発のワークフロー
- [tmaiの強み](./guides/strengths.md) - tmaiが得意なこと
