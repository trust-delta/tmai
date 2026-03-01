# Claude Code Hooks連携

Claude CodeのHTTP Hooksによる高精度な状態検出。

## 概要

Claude Code HooksはClaude Codeからtmaiのウェブサーバーへ、HTTPでリアルタイムにイベント通知を送信します。画面スクレイピングを排除し、イベント駆動型で最高精度の状態検出を実現します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                   Claude Code                                │
│                                                              │
│  SessionStart → UserPromptSubmit → PreToolUse → ...          │
│       │                │                │                    │
│       └────────────────┴────────────────┘                    │
│                        │                                     │
│              HTTP POST /hooks/event                          │
│            + Bearer token認証                                │
│            + X-Tmai-Pane-Id: $TMUX_PANE                      │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      tmai (ウェブサーバー)                    │
│                                                              │
│  POST /hooks/event → HookRegistry → Poller → AgentStatus    │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ

`tmai init` を実行してhooksを自動設定します：

```bash
tmai init
```

このコマンドは：
1. 認証トークンを生成（`~/.config/tmai/hooks_token`）
2. tmaiのhookエントリを `~/.claude/settings.json` にマージ
3. 既存のhooks設定はそのまま保持

トークンの再生成とhooksの再追加：

```bash
tmai init --force
```

tmai hooksの一括削除とトークンの削除：

```bash
tmai uninit
```

## 仕組み

### 3段構え検出

tmaiは状態検出に3段構えのフォールバック戦略を使用します：

| 優先度 | 方式 | 精度 | レイテンシ | 要件 |
|--------|------|------|-----------|------|
| 1（最高） | **HTTP Hooks** | イベント駆動 | リアルタイム | `tmai init` + ウェブサーバー |
| 2 | IPC Socket | 高 | リアルタイム | `tmai wrap` |
| 3（フォールバック） | capture-pane | 中程度 | ポーリング間隔 | なし |

hooksが有効な場合、hook状態が新鮮（30秒以内）であればそれを採用。それ以外はIPC、次にcapture-paneにフォールバックします。

### Hookイベント

tmaiは12種類のClaude Codeイベントを購読します：

| イベント | tmaiの動作 |
|---------|-----------|
| `SessionStart` | 新しいエージェントセッションを登録 |
| `UserPromptSubmit` | ステータス → Processing |
| `PreToolUse` | ステータス → Processing（ツール名を記録） |
| `PostToolUse` | ステータス → Processing |
| `Notification` | ステータス → AwaitingApproval（permission_prompt） |
| `PermissionRequest` | ステータス → AwaitingApproval |
| `Stop` | ステータス → Idle |
| `SubagentStart` | ステータス → Processing |
| `SubagentStop` | ステータス → Processing |
| `TeammateIdle` | チームイベントを発行 |
| `TaskCompleted` | チームイベントを発行 |
| `SessionEnd` | レジストリからセッションを削除 |

### ペインID解決

hookイベントがどのtmuxペインに属するかを3段階で特定：

1. **X-Tmai-Pane-Idヘッダー** — `$TMUX_PANE` 環境変数から注入
2. **セッションID検索** — Claude CodeのセッションIDからペインIDを逆引き
3. **cwdマッチング** — 作業ディレクトリで既知のエージェントとマッチ

### 認証

hookイベントは専用のBearerトークンで認証されます（Web Remote Controlのトークンとは別系統）。

- トークン保存先：`~/.config/tmai/hooks_token`
- パーミッション：`0600`（所有者のみ読み書き可）
- 定数時間比較で検証（タイミング攻撃耐性）

## 比較

| 機能 | Hooks | PTYラッピング | capture-pane |
|------|-------|-------------|--------------|
| セットアップ | `tmai init` | `tmai wrap claude` | 不要 |
| 検出精度 | イベント駆動（最高） | 高 | 中程度 |
| レイテンシ | リアルタイム | リアルタイム | ポーリング間隔 |
| エージェント起動 | 通常の `claude` | `tmai wrap` 経由 | 通常の `claude` |
| 外部送信検知 | なし | あり | なし |
| AskUserQuestion解析 | なし（ステータスのみ） | あり（完全） | 部分的 |
| 既存セッションで動作 | する | 再起動が必要 | する |

**推奨**: hooksを主要な検出方法として使用し、外部送信検知やAskUserQuestionの完全解析が必要な場合にPTYラッピングを追加してください。

## 検出ソース表示

tmaiはステータスバーに使用中の検出方式を表示します：

- `◈ Hook`（Cyan） — HTTP Hooks（最高精度）
- `◉ IPC` — PTYラッピング・IPCソケット（高精度）
- `○ capture` — capture-pane（従来方式）

## パフォーマンス最適化

hook状態が利用可能なエージェントでは、非選択ペインの `capture-pane` をスキップします。これにより多数のエージェント監視時のtmuxコマンドオーバーヘッドが削減されます。

5分以上イベントのない陳腐なhookエントリは自動的にクリーンアップされます。

## トラブルシューティング

### Hooksが動作しない

1. `tmai init` が正常に実行されたか確認：
   ```bash
   # トークンファイルの存在とパーミッションを確認
   test -s ~/.config/tmai/hooks_token && echo "トークンファイルOK" || echo "トークンファイルなし"
   ls -l ~/.config/tmai/hooks_token
   ```
2. `~/.claude/settings.json` にtmaiのhookエントリがあるか確認
3. tmaiのウェブサーバーが起動しているか確認（デフォルトポート9876）
4. ログで認証エラーを確認

### トークンの不一致

異なるトークンでhooksが初期化された場合：

```bash
tmai init --force
```

トークンを再生成し、settings.jsonを更新します。

### hookイベントがtmaiに届かない

1. ウェブサーバーのポートとhook URLのポートが一致しているか確認
2. ファイアウォールがlocalhostへの接続をブロックしていないか確認
3. tmaiのデバッグログでエラーを確認：`tmai --debug`

## 次のステップ

- [PTYラッピング](./pty-wrapping.md) - I/O監視による追加の精度向上
- [Web Remote Control](./web-remote.md) - スマホから操作
- [設定リファレンス](../reference/config.md) - 設定オプション
