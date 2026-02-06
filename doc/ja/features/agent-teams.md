# Agent Teams

Claude Code Agent Teamsのチーム構造とタスク進捗をtmaiから監視。

## 概要

Claude CodeのAgent Teams機能は、複数のAIエージェントがプロジェクトで協調作業し、チームリーダーがチームメイトを調整します。tmaiはこれらのチームを検出し、構造、メンバー、タスク進捗をリアルタイムで表示できます。

> **Note**: Agent Teamsは実験的な機能です。この統合が有効な間、一部の機能（ソート、モニタースコープ）は一時的に固定されています。

## 仕組み

tmaiは`~/.claude/teams/`と`~/.claude/tasks/`ディレクトリをスキャンしてアクティブなAgent Teamsを検出します。チームメンバーとtmuxペインのマッピングは以下の方法で行います：

1. **環境変数**（`CLAUDE_CODE_TASK_LIST_ID`）- 主要な検出方法
2. **コマンドライン引数**（`--agent-id`）- ヒューリスティックなフォールバック

チームデータは設定された`scan_interval`に基づいて定期的に更新されます。

## チーム一覧画面

`T`を押すとチーム一覧画面が開き、以下を表示します：

- 検出された全チーム
- チームメンバーとその役割
- タスクサマリー（合計、完了、進行中、未着手）

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Teams                                                  │
│                                                             │
│ ▸ my-project (3 members, 5 tasks)                           │
│   ├── team-lead (general-purpose)     3/5 tasks done        │
│   ├── researcher (Explore)            Processing             │
│   └── implementer (general-purpose)   Idle                   │
│                                                             │
│ ▸ refactoring (2 members, 3 tasks)                          │
│   ├── lead (general-purpose)          1/3 tasks done        │
│   └── worker (general-purpose)        Approval               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

`Esc`または再度`T`で閉じます。

## タスクオーバーレイ

エージェント一覧でチームメンバーを選択し、`t`を押すとチームのタスク一覧が表示されます：

```
┌─────────────────────────────────────────────────────────────┐
│ Tasks: my-project                                            │
│                                                             │
│ ✓ 1. Set up project structure          (team-lead)          │
│ ✓ 2. Research API design               (researcher)         │
│ ● 3. Implement auth module             (implementer)        │
│ ○ 4. Write tests                       (unassigned)         │
│ ○ 5. Update documentation              (unassigned)         │
│                                                             │
│ ✓ completed  ● in_progress  ○ pending                       │
└─────────────────────────────────────────────────────────────┘
```

`Esc`または再度`t`で閉じます。

## キーバインド

| キー | 動作 |
|------|------|
| `T` | チーム一覧画面の表示/非表示 |
| `t` | タスクオーバーレイの表示/非表示（チームメンバー選択時） |

## 設定

```toml
[teams]
enabled = true       # チームスキャンの有効/無効（デフォルト: true）
scan_interval = 5    # スキャン間隔（ポーリング周期数、デフォルト: 5、約2.5秒）
```

## Web API

チームデータはWeb APIからも利用可能です：

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/teams` | チーム一覧（タスクサマリー付き） |
| GET | `/api/teams/:name/tasks` | チームのタスク一覧 |
| GET | `/api/events` | SSEストリーム（`teams`イベントを含む） |

詳細は[Web APIリファレンス](../reference/web-api.md)を参照。

## 制限事項

- **実験的機能**: APIや動作は将来のバージョンで変更される可能性があります
- **ソートとスコープの無効化**: チーム統合が有効な間、ソート(`s`)はDirectoryに、モニタースコープ(`m`)はAllSessionsに固定されています。将来のアップデートで復活予定です。
- **検出方法**: チームメンバーのマッピングはコマンドライン引数のマッチング（`--agent-id`）に依存しています。このフラグなしで起動されたエージェントは、ヒューリスティックなフォールバックで正確にマッチしない場合があります。
- **ファイルベースのスキャン**: チームデータはファイルシステム（`~/.claude/teams/`、`~/.claude/tasks/`）から読み取られます。変更は次のスキャン間隔で検出されます。

## 次のステップ

- [マルチエージェント監視](../workflows/multi-agent.md) - 一般的なマルチエージェントワークフロー
- [Web APIリファレンス](../reference/web-api.md) - Teams APIドキュメント
- [設定リファレンス](../reference/config.md) - Teams設定オプション
