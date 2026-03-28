# 単一エージェント監視

1つのAIエージェントを監視する基本的な使い方。

## WebUIモード（デフォルト）

```bash
# 1. hooksをセットアップ（初回のみ）
tmai init

# 2. tmaiを起動（Chrome App Modeで開く）
tmai

# 3. 任意のターミナルでClaude Codeを起動
claude
```

tmaiがhooks経由でエージェントを自動検出し、ダッシュボードに表示します。

### WebUIでの操作

- **承認** — 承認ボタンをクリック
- **選択肢選択** — 番号付きの選択肢をクリック
- **テキスト送信** — 入力バーに入力してEnter
- **ターミナル** — インタラクティブターミナルパネルを開く
- **Kill** — エージェントを終了

## TUIモード（`--tmux`）

```bash
# 1. tmuxセッションを作成
tmux new-session -s dev

# 2. Claude Codeを起動
claude

# 3. 別ペインでtmaiを起動（Ctrl+b %で分割）
tmai --tmux
```

### TUIでの操作

| キー | 動作 |
|------|------|
| `y` | 承認（Enterを送信して確定） |
| `1-9` | AskUserQuestionの選択肢を選択 |
| `Space` | 複数選択時のトグル |
| `p` | パススルーモード（直接入力、Escで戻る） |
| `Ctrl+d/u` | プレビュースクロール |

## Claude Code Hooks連携（推奨）

最高精度の状態検出のため、初回に `tmai init` を実行：

```bash
# 初回セットアップ
tmai init

# あとは通常通りclaudeを使用
claude
```

特別なラッパー不要 — hooksがtmaiに直接イベントを送信します。

## PTYラッピングモード（オプション）

外部送信検知などの追加機能が必要な場合：

```bash
# claudeの代わりに
tmai wrap claude
```

追加のメリット：
- 外部送信検知が有効
- AskUserQuestionの選択肢を完全に解析
- I/Oの直接監視

## 次のステップ

- [マルチエージェント監視](./multi-agent.md) - 複数エージェントを同時に
- [スマホから承認](./remote-approval.md) - 外出先からも操作
