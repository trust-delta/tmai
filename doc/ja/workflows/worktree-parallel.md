# ワークツリーで並列開発

Gitワークツリーを使って、複数のエージェントが独立したブランチで並列開発するワークフロー。

## 概要

tmaiは「監視に徹する」ツールなので、ワークツリーの作成方法は自由です。
好きな方法でワークツリーを作り、そこでエージェントを起動すれば、tmaiが自動で検出します。

```
┌─────────────────────────────────────────────────────────────┐
│ ワークフロー                                                 │
│                                                             │
│  1. git worktree で作業ディレクトリを作成                   │
│  2. そこで claude を起動                                     │
│  3. tmai が自動検出して監視開始                             │
│  4. 動かしながら追加もOK                                    │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ

### ワークツリーの作成

```bash
# メインリポジトリにいる状態で
cd ~/myproject

# feature-a 用のワークツリーを作成
git worktree add ../myproject-feature-a -b feature-a

# feature-b 用のワークツリーを作成
git worktree add ../myproject-feature-b -b feature-b

# bugfix 用のワークツリーを作成
git worktree add ../myproject-bugfix -b bugfix/issue-123
```

結果：

```
~/
├── myproject/              # main ブランチ
├── myproject-feature-a/    # feature-a ブランチ
├── myproject-feature-b/    # feature-b ブランチ
└── myproject-bugfix/       # bugfix/issue-123 ブランチ
```

### 各ワークツリーでエージェントを起動

```bash
# tmuxで各ワークツリーにウィンドウを作成
tmux new-window -n feature-a -c ~/myproject-feature-a
tmux new-window -n feature-b -c ~/myproject-feature-b
tmux new-window -n bugfix -c ~/myproject-bugfix

# 各ウィンドウでclaudeを起動
# (各ウィンドウに移動して)
claude
```

または、PTYラッピングで起動（推奨）：

```bash
# 各ウィンドウで
tmai wrap claude
```

### tmaiで監視

```bash
# 別ウィンドウでtmaiを起動
tmux new-window -n monitor
tmai
```

tmaiが自動的にすべてのエージェントを検出します。

## 動的に追加する

tmaiの強みは、**動かしながら追加できる**こと。

```bash
# 新しいタスクが発生！
git worktree add ../myproject-hotfix -b hotfix/urgent

# 新しいウィンドウでclaudeを起動
tmux new-window -n hotfix -c ~/myproject-hotfix
claude

# → tmaiが自動で検出、監視対象に追加される
```

## 実践例

```
┌─────────────────────────────────────────────────────────────┐
│ ディレクトリ構成                                             │
│                                                             │
│  ~/myproject/           (main)                              │
│  ~/myproject-feature-a/ (feature-a) ← Agent 1              │
│  ~/myproject-feature-b/ (feature-b) ← Agent 2              │
│  ~/myproject-bugfix/    (bugfix)    ← Agent 3              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ tmux                                                        │
│                                                             │
│  Window 1: ~/myproject-feature-a  claude                   │
│  Window 2: ~/myproject-feature-b  claude                   │
│  Window 3: ~/myproject-bugfix     claude                   │
│  Window 4: tmai                    ← 全体監視              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ tmai画面                                                     │
│                                                             │
│  ┌─ Agents ─────────────────┬─ Preview ─────────────────┐  │
│  │ ● feature-a [Approval]   │ ファイル作成の確認...      │  │
│  │   feature-b [Processing] │                            │  │
│  │   bugfix    [Idle]       │ [Yes] [No]                │  │
│  └──────────────────────────┴────────────────────────────┘  │
│                                                             │
│  → 各エージェントは独立ブランチで作業                       │
│  → コンフリクトなし                                         │
│  → 失敗したらブランチごと破棄すればOK                       │
└─────────────────────────────────────────────────────────────┘
```

## ワークツリーの削除

作業完了後：

```bash
# マージ
cd ~/myproject
git merge feature-a

# ワークツリーを削除
git worktree remove ../myproject-feature-a
```

## メリット

| 観点 | 説明 |
|------|------|
| 独立性 | 各エージェントが別ブランチで作業、コンフリクトなし |
| 安全性 | 失敗したらブランチごと破棄できる |
| 柔軟性 | 動かしながら追加・削除が自由 |
| シンプルさ | tmaiはワークツリーを強制しない、使いたい時だけ使える |

## tmaiの思想

tmaiは「ワークツリーを管理する」のではなく「監視に徹する」ツールです。

- ワークツリーの作り方は自由
- 使わなくてもOK
- 使うなら、好きなタイミングで追加できる
- 既存のワークフローを変えなくていい

## 次のステップ

- [マルチエージェント監視](./multi-agent.md) - 基本的な複数エージェント監視
- [ベストプラクティス](../guides/best-practices.md) - おすすめの使い方
