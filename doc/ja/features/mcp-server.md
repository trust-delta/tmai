# MCPサーバー

tmaiをModel Context Protocol (MCP) サーバーとして公開し、AIエージェントがプログラマティックに他のエージェントをオーケストレーションできるようにします。

## 概要

tmaiのMCPサーバーを使うと、AIエージェント（例: Claude Code）が標準化されたMCPツールを通じてtmaiを操作できます。エージェントの一覧取得、権限承認、worktree作成、CI確認などが可能です。これにより、自律的な開発サイクルの基盤となります:

**Issue → Worktree → Agent → PR → Review → Merge**

MCPサーバーはClaude Codeがサブプロセスとして起動し、stdio（JSON-RPC 2.0）で通信します。稼働中のtmaiインスタンスのHTTP APIに接続して動作します。

```
Claude Code（コンシューマー）
    ↓ サブプロセス起動
tmai mcp（stdio JSON-RPC）
    ↓ HTTP + Bearerトークン
tmai WebUI（localhost:{port}）
    ↓
TmaiCore（エージェント管理、GitHub、Git）
```

## セットアップ

### 1. tmaiの初期化

```bash
# hooks + MCP設定をセットアップ（初回のみ）
tmai init
```

これにより `~/.claude.json` にMCPサーバーが登録されます:

```json
{
  "mcpServers": {
    "tmai": {
      "type": "stdio",
      "command": "tmai",
      "args": ["mcp"]
    }
  }
}
```

### 2. tmaiを起動

```bash
# WebUIを起動（MCPサーバーには稼働中のtmaiインスタンスが必要）
tmai
```

### 3. Claude Codeから使用

設定完了後、Claude CodeからtmaiのMCPツールを直接使用できます。ツールはClaude Codeのツールリストに `mcp__tmai__*` として表示されます。

## 利用可能なツール

### エージェントクエリ

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `list_agents` | 監視中の全エージェントとステータスを一覧 | — |
| `get_agent` | 特定のエージェントの詳細情報を取得 | `id` |
| `get_agent_output` | エージェントのターミナル出力を取得 | `id` |
| `get_transcript` | 会話トランスクリプトを取得（JSONLセッションログから） | `id` |

### エージェントアクション

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `approve` | 権限リクエストを承認 | `id` |
| `send_text` | エージェントにテキスト入力を送信 | `id`, `text` |
| `send_key` | 特殊キーを送信（Enter, Escape, Tabなど） | `id`, `key` |
| `select_choice` | AskUserQuestionの選択肢を選択 | `id`, `index` |

### チームクエリ

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `list_teams` | Claude Code Agent Teamsとタスク進捗を一覧 | — |

### Worktree管理

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `list_worktrees` | 全worktreeとリンクされたエージェント・diff統計を一覧 | — |
| `spawn_agent` | ディレクトリに新しいAIエージェントを起動 | `directory`, `prompt?` |
| `spawn_worktree` | worktreeを作成しエージェントを起動 | `name`, `repo?`, `base_branch?`, `prompt?` |
| `delete_worktree` | git worktreeを削除 | `worktree_name`, `repo?`, `force?` |

### GitHub

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `list_prs` | オープンPRをCI・レビュー状態付きで一覧 | `repo?` |
| `list_issues` | オープンIssueを一覧 | `repo?` |
| `get_ci_status` | ブランチのCIチェック結果を取得 | `branch`, `repo?` |
| `get_pr_comments` | PRのコメント・レビューを取得 | `pr_number`, `repo?` |
| `get_pr_merge_status` | マージ状態を取得（マージ可能性、CI、レビュー） | `pr_number`, `repo?` |
| `get_ci_failure_log` | CI失敗ログを取得（デバッグ用） | `branch`, `repo?` |
| `rerun_ci` | 失敗したCIチェックを再実行 | `branch`, `repo?` |

### Git

| ツール | 説明 | パラメータ |
|--------|------|------------|
| `list_branches` | gitブランチを一覧 | `repo?` |
| `git_diff_stat` | ブランチのdiff統計を取得（ベースとの比較） | `branch`, `repo?` |

## 使用例: 自律的なIssue解決

オーケストレーション用のClaude Codeエージェントは、tmai MCPツールを使って完全な開発サイクルを駆動できます:

```
1. list_issues          → 作業するIssueを選択
2. spawn_worktree       → 隔離されたworktreeを作成、resolve promptでエージェント起動
3. get_agent            → エージェントの進捗を監視
4. approve              → 保留中の権限を承認
5. list_prs             → PRが作成されたか確認
6. get_ci_status        → CIの通過を確認
7. get_pr_merge_status  → PRがマージ可能か確認
```

## アーキテクチャ

- **トランスポート**: stdio（標準入出力）、JSON-RPC 2.0
- **SDK**: [rmcp](https://github.com/modelcontextprotocol/rust-sdk)（AnthropicによるRust MCP SDK）
- **接続**: `~/.local/share/tmai/api.json` からポートと認証トークンを読み取り（稼働中のtmaiインスタンスが書き込み、0600パーミッション）
- **設計**: 既存のTmaiCore HTTP APIの薄いラッパー — 個別のビジネスロジックは持たない

## 関連ドキュメント

- [エージェント起動](./agent-spawn.md) — WebUIからのエージェント起動
- [Worktree管理](./worktree-ui.md) — Git worktree操作
- [GitHub連携](./github-integration.md) — PR・CI機能
- [Hooks](./hooks.md) — Claude Code Hooks連携
- [Web APIリファレンス](../reference/web-api.md) — 基盤となるHTTP API
- [Issue駆動オーケストレーション](../workflows/issue-driven-orchestration.md) — MCPツールを使ったワークフロー
