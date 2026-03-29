# Web APIリファレンス

tmaiの完全なREST API、SSEイベント、WebSocketエンドポイント。

## ベースURL

```
http://localhost:9876
```

デフォルトポート: `9876`（設定の`[web] port`で変更可能）。

## 認証

すべてのAPIエンドポイントにトークン認証が必要です：

- **推奨**: `Authorization: Bearer <token>` ヘッダー
- **フォールバック**: `?token=<token>` クエリパラメータ（SSE EventSource用）

トークンは起動時に生成され、ブラウザURLに表示されます。

Hookエンドポイントは別のトークン（`~/.config/tmai/hooks_token`）を使用します。

## エラーレスポンス

| ステータス | 説明 |
|----------|------|
| `400` | リクエスト不正（入力無効、パストラバーサル、バリデーションエラー） |
| `401` | トークン無効または欠落 |
| `404` | リソースが見つからない |
| `500` | サーバー内部エラー |

エラーボディ:

```json
{
  "error": "エラーの説明"
}
```

---

## エージェント操作

### GET /api/agents

監視中の全エージェントを一覧表示。

**レスポンス**: `AgentSnapshot[]`

### GET /api/agents/{id}/preview

エージェントのペイン内容を取得。

**レスポンス**:

```json
{
  "content": "$ claude\nWelcome to Claude Code...",
  "lines": 42
}
```

### GET /api/agents/{id}/output

エージェントの生出力を取得（PTYセッション用）。

**レスポンス**:

```json
{
  "session_id": "a1b2c3d4",
  "output": "...",
  "bytes": 4096
}
```

### POST /api/agents/{id}/approve

エージェントに承認（y + Enter）を送信。

**レスポンス**: `{"status": "ok"}`

### POST /api/agents/{id}/select

AskUserQuestionの選択肢を選択。

**リクエスト**:

```json
{
  "choice": 2
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `choice` | number | 選択肢番号（1-indexed） |

### POST /api/agents/{id}/submit

複数選択を確定。

**リクエスト**:

```json
{
  "selected_choices": [1, 3]
}
```

### POST /api/agents/{id}/input

エージェントにテキスト入力を送信。

**リクエスト**:

```json
{
  "text": "hello world"
}
```

### POST /api/agents/{id}/key

エージェントに特殊キーを送信。

**リクエスト**:

```json
{
  "key": "Enter"
}
```

### POST /api/agents/{id}/passthrough

生のターミナル入力（文字列またはキー）を送信。

**リクエスト**:

```json
{
  "chars": "ls -la",
  "key": "Enter"
}
```

両フィールドはオプション — どちらか一方または両方を送信。

### PUT /api/agents/{id}/auto-approve

エージェントごとのAuto-approveオーバーライドを設定。

**リクエスト**:

```json
{
  "enabled": true
}
```

### POST /api/agents/{id}/kill

エージェントプロセスを終了。

**レスポンス**: `{"status": "ok"}`

### POST /api/agents/{from}/send-to/{to}

あるエージェントから別のエージェントにテキストを送信。

**リクエスト**:

```json
{
  "text": "Check the auth module"
}
```

**レスポンス**:

```json
{
  "status": "ok",
  "method": "ipc"
}
```

---

## Teams

### GET /api/teams

検出された全Agent Teamsを一覧表示。

**レスポンス**:

```json
[
  {
    "name": "my-project",
    "description": "プロジェクトの説明",
    "task_summary": {
      "total": 5,
      "completed": 2,
      "in_progress": 1,
      "pending": 2
    },
    "members": [
      {
        "name": "team-lead",
        "agent_type": "general-purpose",
        "is_lead": true,
        "pane_target": "main:0.1",
        "current_task": {
          "id": "1",
          "subject": "Implement auth",
          "status": "in_progress"
        }
      }
    ],
    "worktree_names": ["feature-a"]
  }
]
```

### GET /api/teams/{name}/tasks

特定チームのタスク一覧を取得。

**レスポンス**:

```json
[
  {
    "id": "1",
    "subject": "Implement auth module",
    "description": "...",
    "active_form": "Implementing auth",
    "status": "completed",
    "owner": "team-lead",
    "blocks": [],
    "blocked_by": []
  }
]
```

---

## ワークツリー

### GET /api/worktrees

全ワークツリーを一覧表示。**レスポンス**: `WorktreeSnapshot[]`

### POST /api/worktrees

新しいワークツリーを作成。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch_name": "feature-xyz",
  "base_branch": "main"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `repo_path` | string | はい | リポジトリパス |
| `branch_name` | string | はい | ワークツリー用ブランチ名 |
| `base_branch` | string | いいえ | ベースブランチ（デフォルト: 現在のブランチ） |

**レスポンス**: `{"status": "ok", "path": "...", "branch": "..."}`

### POST /api/worktrees/delete

ワークツリーを削除。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "worktree_name": "feature-xyz",
  "force": false
}
```

### POST /api/worktrees/launch

ワークツリー内でエージェントを起動。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "worktree_name": "feature-xyz",
  "agent_type": "claude",
  "session": null
}
```

### POST /api/worktrees/diff

ワークツリーとベースブランチ間の差分を取得。

**リクエスト**:

```json
{
  "worktree_path": "/home/user/myrepo/.claude/worktrees/feature-xyz",
  "base_branch": "main"
}
```

**レスポンス**: `{"diff": "...", "summary": "..."}`

---

## Git操作

### GET /api/git/branches

親関係付きブランチ一覧。

**クエリ**: `?repo=/path/to/repo`

**レスポンス**: `BranchListResult`（親情報、トラッキング状態、ahead/behindカウント付きブランチ）

### GET /api/git/log

ブランチのコミットログを取得。

**クエリ**: `?repo=/path/to/repo&base=main&branch=feature-a`

**レスポンス**: `CommitEntry[]`

### GET /api/git/graph

レーンベース可視化用のコミットグラフデータを取得。

**クエリ**: `?repo=/path/to/repo&limit=100`

**レスポンス**: レーン、行、接続を含むグラフレイアウトデータ。

### POST /api/git/branches/create

新しいブランチを作成。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "name": "feature-new",
  "base": "main"
}
```

### POST /api/git/branches/delete

ブランチを削除。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-old",
  "force": false
}
```

### POST /api/git/checkout

ブランチを切り替え。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-a"
}
```

### POST /api/git/fetch

リモートからフェッチ。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "remote": "origin"
}
```

### POST /api/git/pull

リモートからプル。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo"
}
```

### POST /api/git/merge

ブランチをマージ。

**リクエスト**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-a"
}
```

---

## GitHub連携

`gh` CLIのインストールと認証が必要です。

### GET /api/github/prs

オープンなPull Requestを一覧表示。

**クエリ**: `?repo=/path/to/repo`

**レスポンス**: `HashMap<branch_name, PrInfo>` — ブランチ名をキーとしたPR情報。

### GET /api/github/checks

ブランチのCIチェック状態を一覧表示。

**クエリ**: `?repo=/path/to/repo&branch=feature-a`

**レスポンス**: ロールアップステータスと個別チェックを含む`CiSummary`。

### GET /api/github/issues

リポジトリのIssueを一覧表示。

**クエリ**: `?repo=/path/to/repo`

**レスポンス**: タイトル、ラベル、状態、番号を含む`IssueInfo[]`。

---

## ファイル操作

### GET /api/files/read

ファイルを読み取り（最大1MB）。

**クエリ**: `?path=/path/to/file`

**レスポンス**:

```json
{
  "path": "/path/to/file",
  "content": "ファイル内容...",
  "editable": true
}
```

`editable`フラグはサポートされるファイルタイプ（`.md`, `.json`, `.toml`, `.txt`, `.yaml`, `.yml`）で`true`。

### POST /api/files/write

ファイル内容を書き込み（サポートされるファイルタイプのみ、既存ファイルのみ）。

**リクエスト**:

```json
{
  "path": "/path/to/file.md",
  "content": "新しい内容"
}
```

### GET /api/files/md-tree

ディレクトリ内のmarkdown/設定ファイルのファイルツリーを取得。

**クエリ**: `?root=/path/to/project`

**レスポンス**:

```json
[
  {
    "name": "CLAUDE.md",
    "path": "/path/to/project/CLAUDE.md",
    "is_dir": false,
    "openable": true,
    "children": null
  },
  {
    "name": "doc",
    "path": "/path/to/project/doc",
    "is_dir": true,
    "openable": false,
    "children": [...]
  }
]
```

---

## プロジェクト

### GET /api/projects

登録済みプロジェクトディレクトリを一覧表示。

**レスポンス**: `string[]`（絶対パス）

### POST /api/projects

プロジェクトディレクトリを追加。

**リクエスト**:

```json
{
  "path": "/home/user/myproject"
}
```

### POST /api/projects/remove

登録済みプロジェクトを削除。

**リクエスト**:

```json
{
  "path": "/home/user/myproject"
}
```

### GET /api/directories

ディレクトリ内容を一覧表示。

**クエリ**: `?path=/home/user`（オプション、デフォルトはホームディレクトリ）

**レスポンス**:

```json
[
  {
    "name": "myproject",
    "path": "/home/user/myproject",
    "is_git": true
  }
]
```

---

## スポーン

### POST /api/spawn

PTYセッションでエージェントをスポーン。

**リクエスト**:

```json
{
  "command": "claude",
  "args": [],
  "cwd": "/home/user/project",
  "rows": 24,
  "cols": 80,
  "force_pty": false
}
```

許可されるコマンド: `claude`, `codex`, `gemini`, `bash`, `sh`, `zsh`

**レスポンス**:

```json
{
  "session_id": "a1b2c3d4-...",
  "pid": 12345,
  "command": "claude"
}
```

### POST /api/spawn/worktree

新しいワークツリーでエージェントをスポーン。

**リクエスト**:

```json
{
  "name": "feature-xyz",
  "cwd": "/home/user/myrepo",
  "base_branch": "main",
  "rows": 24,
  "cols": 80
}
```

---

## 設定

### GET /api/settings/spawn

スポーン設定を取得。

**レスポンス**:

```json
{
  "use_tmux_window": false,
  "tmux_available": true,
  "tmux_window_name": "tmai-agents"
}
```

### PUT /api/settings/spawn

スポーン設定を更新。

**リクエスト**:

```json
{
  "use_tmux_window": true,
  "tmux_window_name": "my-agents"
}
```

### GET /api/settings/auto-approve

Auto-approve設定を取得。

**レスポンス**:

```json
{
  "mode": "hybrid",
  "running": true
}
```

### PUT /api/settings/auto-approve

Auto-approveモードを変更。

**リクエスト**:

```json
{
  "mode": "rules"
}
```

モード: `off`, `rules`, `ai`, `hybrid`

### GET /api/settings/usage

使用量トラッキング設定を取得。

**レスポンス**:

```json
{
  "enabled": true,
  "auto_refresh_min": 5
}
```

### PUT /api/settings/usage

使用量トラッキング設定を更新。

**リクエスト**:

```json
{
  "enabled": true,
  "auto_refresh_min": 10
}
```

---

## セキュリティ

### POST /api/security/scan

セキュリティスキャンを実行。

**レスポンス**: リスク、スキャン済みファイル、タイムスタンプを含む`ScanResult`。

### GET /api/security/last

最後のスキャン結果（キャッシュ）を取得。

**レスポンス**: `ScanResult` またはスキャン未実行の場合`null`。

---

## 使用量

### GET /api/usage

現在の使用量メーターデータを取得。

**レスポンス**: メーター値、パーセンテージ、リセット情報を含む`UsageSnapshot`。

### POST /api/usage/fetch

プロバイダーからの使用量データ取得をトリガー。

**レスポンス**: `202 Accepted`

---

## SSEイベント

### GET /api/events

リアルタイム更新のためのServer-Sent Eventsストリーム。

**認証**: クエリパラメータ（`?token=<token>`）、EventSourceはヘッダーを設定できないため。

**Keep-alive**: 15秒間隔。

**イベントタイプ**:

| イベント | ペイロード | 説明 |
|---------|---------|------|
| `agents` | `AgentSnapshot[]` | エージェントのステータス変化（重複排除済み） |
| `teams` | `TeamInfoResponse[]` | チーム構造の更新 |
| `teammate_idle` | `{team_name, member_name}` | チームメンバーがアイドルになった |
| `task_completed` | `{team_name, task_id, task_subject}` | タスク完了 |
| `context_compacting` | `{target, compaction_count}` | エージェントのコンテキスト圧縮 |
| `usage` | `UsageSnapshot` | 使用量メーターの更新 |
| `worktree_created` | `{target, worktree}` | ワークツリー作成 |
| `worktree_removed` | `{target, worktree}` | ワークツリー削除 |
| `review_launched` | `{source_target, review_target}` | コードレビュー開始 |
| `review_completed` | `{source_target, summary}` | コードレビュー完了 |

---

## WebSocketターミナル

### ANY /api/agents/{id}/terminal

インタラクティブターミナルI/O用WebSocket接続。

**認証**: クエリパラメータ（`?token=<token>`）。

**プロトコル**:

| 方向 | フレームタイプ | 内容 |
|------|-------------|------|
| サーバー → クライアント | Binary | 生PTY出力（ANSIエスケープ） |
| クライアント → サーバー | Binary | 生キーボード入力バイト |
| クライアント → サーバー | Text (JSON) | コントロールメッセージ |

**コントロールメッセージ**:

```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

**機能**:
- 接続時のスクロールバックバッファリプレイ
- 切断時の自動クリーンアップ

---

## Hookエンドポイント

Claude Code hookイベント用の内部エンドポイント。`tmai init`で設定されます。

### POST /hooks/event

Claude Code hookイベントを受信。

**認証**: `Authorization: Bearer <hooks_token>`（Web APIトークンとは別）

**リクエスト**: Claude Codeからの`HookEventPayload`

**レスポンス**（イベントにより異なる）:

- **PreToolUse**: Auto-approve判定を返却

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "approved",
    "permissionDecisionReason": "tmai auto-approve: rules:allow_read"
  }
}
```

- **TeammateIdle / TaskCompleted**: 継続シグナルを返却

```json
{
  "continue": true,
  "stopReason": null
}
```

- **その他のイベント**: `{}`

### POST /hooks/review-complete

レビュー完了通知を受信。

**認証**: `Authorization: Bearer <hooks_token>`

**リクエスト**:

```json
{
  "source_target": "main:0.1",
  "summary": "レビューサマリー..."
}
```

---

## 例

```bash
TOKEN="your-token-here"
BASE="http://localhost:9876"

# エージェント一覧
curl "$BASE/api/agents?token=$TOKEN"

# 承認
curl -X POST "$BASE/api/agents/main:0.1/approve" \
  -H "Authorization: Bearer $TOKEN"

# テキスト送信
curl -X POST "$BASE/api/agents/main:0.1/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'

# ブランチ一覧
curl "$BASE/api/git/branches?repo=/path/to/repo&token=$TOKEN"

# ワークツリー作成
curl -X POST "$BASE/api/worktrees" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"/path/to/repo","branch_name":"feature-xyz","base_branch":"main"}'

# SSEストリーム
curl "$BASE/api/events?token=$TOKEN"

# エージェントスポーン
curl -X POST "$BASE/api/spawn" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"claude","cwd":"/path/to/project"}'

# セキュリティスキャン
curl -X POST "$BASE/api/security/scan" \
  -H "Authorization: Bearer $TOKEN"

# チーム一覧
curl "$BASE/api/teams?token=$TOKEN"
```
