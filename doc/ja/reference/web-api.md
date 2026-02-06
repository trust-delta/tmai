# Web APIリファレンス

Web Remote ControlのREST API。

## ベースURL

```
http://<host>:<port>/?token=<token>
```

デフォルトポート：`9876`

すべてのAPIエンドポイントにはクエリパラメータとしてトークンが必要です。

## 認証

すべてのリクエストにトークンを含める必要があります：

```
GET /api/agents?token=abc123
POST /api/agents/1/approve?token=abc123
```

トークンはQRコードのURLに表示されます。

## エンドポイント

### GET /api/agents

監視中の全エージェントを一覧表示。

**レスポンス：**

```json
{
  "agents": [
    {
      "id": "0",
      "name": "dev:claude",
      "status": "awaiting_approval",
      "approval_type": "user_question",
      "details": "どのアプローチを好みますか？",
      "choices": ["async/await", "callbacks", "promises"],
      "multi_select": false,
      "cursor_position": 1,
      "detection_source": "pty"
    },
    {
      "id": "1",
      "name": "dev:codex",
      "status": "processing",
      "detection_source": "capture"
    }
  ]
}
```

**Agentオブジェクト：**

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | string | ユニークなエージェント識別子 |
| `name` | string | 表示名（session:window） |
| `status` | string | `processing`, `idle`, `awaiting_approval` |
| `approval_type` | string? | 必要な承認のタイプ |
| `details` | string? | 承認リクエストの説明 |
| `choices` | string[]? | AskUserQuestionの選択肢 |
| `multi_select` | bool? | 複数選択が有効か |
| `cursor_position` | number? | 現在の選択位置（1-indexed） |
| `detection_source` | string | `pty`または`capture` |

### POST /api/agents/:id/approve

エージェントに承認（y）を送信。

**リクエスト：**

```
POST /api/agents/0/approve?token=abc123
```

**レスポンス：**

```json
{
  "success": true
}
```

### POST /api/agents/:id/select

AskUserQuestionの選択肢を選択。

**リクエスト：**

```
POST /api/agents/0/select?token=abc123
Content-Type: application/json

{
  "option": 2
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `option` | number | 選択肢番号（1-indexed） |

**レスポンス：**

```json
{
  "success": true
}
```

### POST /api/agents/:id/submit

複数選択を確定。

**リクエスト：**

```
POST /api/agents/0/submit?token=abc123
Content-Type: application/json

{
  "selections": [1, 3]
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `selections` | number[] | 選択した選択肢番号（1-indexed） |

**レスポンス：**

```json
{
  "success": true
}
```

### POST /api/agents/:id/input

エージェントにテキスト入力を送信。

**リクエスト：**

```
POST /api/agents/0/input?token=abc123
Content-Type: application/json

{
  "text": "https://api.example.com"
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `text` | string | 送信するテキスト |

**レスポンス：**

```json
{
  "success": true
}
```

### GET /api/agents/:id/preview

エージェントのペイン内容を取得。

**リクエスト：**

```
GET /api/agents/0/preview?token=abc123
```

**レスポンス：**

```json
{
  "content": "$ claude\n\nWelcome to Claude Code...\n\n> Working on task..."
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `content` | string | ペイン内容（ANSIコード除去済み） |

### GET /api/events

リアルタイム更新のためのServer-Sent Eventsストリーム。

**リクエスト：**

```
GET /api/events?token=abc123
```

**レスポンス：**

```
event: agents
data: {"agents":[...]}

event: teams
data: {"teams":[...]}
```

| イベント | 説明 |
|---------|------|
| `agents` | エージェントの状態が変化した時に送信 |
| `teams` | チーム/タスクのデータが変化した時に送信 |

### GET /api/teams

検出されたAgent Teamsをタスクサマリー付きで一覧表示。

**リクエスト：**

```
GET /api/teams?token=abc123
```

**レスポンス：**

```json
{
  "teams": [
    {
      "name": "my-project",
      "members": [
        {
          "name": "team-lead",
          "agent_type": "general-purpose"
        },
        {
          "name": "researcher",
          "agent_type": "Explore"
        }
      ],
      "task_summary": {
        "total": 5,
        "completed": 2,
        "in_progress": 1,
        "pending": 2
      }
    }
  ]
}
```

### GET /api/teams/:name/tasks

特定チームのタスク一覧を取得。

**リクエスト：**

```
GET /api/teams/my-project/tasks?token=abc123
```

**レスポンス：**

```json
{
  "tasks": [
    {
      "id": "1",
      "subject": "Implement auth module",
      "status": "completed",
      "owner": "researcher"
    },
    {
      "id": "2",
      "subject": "Write tests",
      "status": "in_progress",
      "owner": "team-lead"
    }
  ]
}
```

## エラーレスポンス

### 401 Unauthorized

無効または欠落したトークン。

```json
{
  "error": "Invalid token"
}
```

### 404 Not Found

エージェントが見つからない。

```json
{
  "error": "Agent not found"
}
```

### 500 Internal Server Error

サーバーエラー（ログを確認）。

```json
{
  "error": "Internal server error"
}
```

## ステータス値

| ステータス | 説明 |
|----------|------|
| `processing` | エージェントが作業中 |
| `idle` | エージェントが入力待ち |
| `awaiting_approval` | エージェントがユーザー承認待ち |

## 承認タイプ

| タイプ | 説明 |
|------|------|
| `file_edit` | ファイル編集の承認 |
| `shell_command` | シェルコマンドの実行 |
| `mcp_tool` | MCPツールの使用 |
| `user_question` | AskUserQuestion |
| `yes_no` | シンプルなYes/No確認 |
| `other` | その他の承認タイプ |

## 検出ソース

| ソース | 説明 |
|--------|------|
| `pty` | PTYラッピング（高精度） |
| `capture` | tmux capture-pane（従来方式） |

## 例：curl

```bash
TOKEN="your-token-here"
BASE="http://localhost:9876"

# エージェント一覧
curl "$BASE/api/agents?token=$TOKEN"

# 承認
curl -X POST "$BASE/api/agents/0/approve?token=$TOKEN"

# 選択肢2を選択
curl -X POST "$BASE/api/agents/0/select?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"option": 2}'

# テキスト送信
curl -X POST "$BASE/api/agents/0/input?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'

# チーム一覧
curl "$BASE/api/teams?token=$TOKEN"

# チームタスク取得
curl "$BASE/api/teams/my-project/tasks?token=$TOKEN"
```

## 次のステップ

- [Web Remote Control](../features/web-remote.md) - 機能概要
- [設定リファレンス](./config.md) - 設定オプション
