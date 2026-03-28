# エージェント起動

WebUIから直接新しいAIエージェントを起動します。

## 概要

エージェント起動機能を使用すると、ブラウザから離れることなくダッシュボードから新しいAIエージェントセッションを開始できます。エージェントはPTYモードまたはtmuxウィンドウモードで起動可能です。

## エージェントの起動方法

### 起動ダイアログから

1. UIから起動インターフェースを開く
2. エージェントコマンドを選択（Claude Code、Codex CLI、Gemini CLI、bashなど）
3. 作業ディレクトリを設定
4. ターミナルサイズを設定（行数、列数）
5. 起動をクリック

### Worktreeから

ブランチグラフまたはWorktreeパネルで**エージェントを起動**をクリックすると、そのworktreeのディレクトリに事前設定されたエージェントが起動します。

### アクションパネルから

worktreeを持つブランチを選択し、**エージェントを起動**をクリックすると、worktreeのディレクトリでAIエージェントが起動します。

## 起動モード

### PTYモード（デフォルト）

tmaiが管理する擬似ターミナルでエージェントを起動します:

- WebSocket経由のフルターミナルI/O
- ブラウザ上でのxterm.jsレンダリング
- 非ASCII入力用のIMEサポート
- tmux不要で動作

### tmuxウィンドウモード

新しいtmuxウィンドウでエージェントを起動します:

- エージェントはtmuxセッション内で実行
- WebUIとtmuxの両方からアクセス可能
- ブラウザとターミナルを切り替えて使いたい場合に便利

デフォルトモードの設定:

```toml
# ~/.config/tmai/config.toml
[spawn]
use_tmux_window = false    # true = tmuxウィンドウ、false = PTY（デフォルト）
tmux_window_name = "tmai"  # tmuxウィンドウ名（tmuxモード使用時）
```

## 許可されたコマンド

セキュリティのため、ホワイトリストに登録されたコマンドのみ起動可能です:

| コマンド | 説明 |
|----------|------|
| `claude` | Claude Code |
| `codex` | Codex CLI |
| `gemini` | Gemini CLI |
| `bash` | Bashシェル |
| `sh` | POSIXシェル |
| `zsh` | Zシェル |

## APIエンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/spawn` | PTYでエージェントを起動 |
| POST | `/api/spawn/worktree` | worktreeでエージェントを起動 |
| GET | `/api/settings/spawn` | 起動設定を取得 |
| PUT | `/api/settings/spawn` | 起動設定を更新 |

### 起動リクエスト

```json
{
  "command": "claude",
  "args": [],
  "cwd": "/home/user/project",
  "rows": 24,
  "cols": 80
}
```

### 起動レスポンス

```json
{
  "session_id": "a1b2c3d4-...",
  "pid": 12345,
  "command": "claude"
}
```

## 関連ドキュメント

- [ターミナルパネル](./terminal-panel.md) -- 起動されたエージェントのターミナル機能
- [Worktree管理](./worktree-ui.md) -- worktreeでのエージェント起動
- [WebUI概要](./webui-overview.md) -- ダッシュボードレイアウト
