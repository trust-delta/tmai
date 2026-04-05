# Issue駆動オーケストレーション

**オーケストレーターエージェント**（tmai MCPツールを使用するClaude Codeセッション）がGitHub Issue、ワークツリー、PRを通じてサブエージェントを自律的に管理するワークフロー。

## 概要

オーケストレーターはtmaiのMCPツールを使って、IssueのトリアージからPRマージまでの完全な開発サイクルを駆動するClaude Codeエージェントです。手動のWebUI操作は不要です。

```
┌─────────────────────────────────────────────────────────────┐
│ オーケストレーターエージェント（MCP駆動）                     │
│                                                             │
│  1. list_issues        → ディスパッチする作業を特定         │
│  2. dispatch_issue     → ワークツリー + エージェント（一括） │
│  3. list_agents        → サブエージェントの進捗を監視       │
│  4. get_ci_status      → CI結果を確認                       │
│  5. send_prompt        → 失敗修正の指示を送信               │
│  6. gh pr merge        → 通過したPRをマージ                 │
│  7. delete_worktree    → マージ後のクリーンアップ           │
│  8. ループ             → 次のIssueまたは次のサイクルへ      │
└─────────────────────────────────────────────────────────────┘
```

tmaiは**「AI開発ツールのKubernetes」** — IDE非依存・マルチベンダーの、自律型コーディングエージェントを統括するオーケストレーション基盤です。

## オーケストレーターループ

### Step 1: Issueの特定

オーケストレーターがオープンIssueを一覧し、ディスパッチ対象を決定：

```
Orchestrator: list_issues
  → #270 feat: add retry logic to MCP reconnect
  → #271 fix: branch graph label overlap
  → #272 docs: update orchestration docs
  → #273 fix: worktree cleanup race condition
```

ユーザーが会話中にIssueを作成することも可能：

```
You: "ペインが小さいときにカーソルオーバーレイがずれる。Issue作って。"
Orchestrator: → gh issue create --title "fix: cursor overlay misalignment..."
```

### Step 2: サブエージェントへのディスパッチ

`dispatch_issue` を使用 — Issueの取得、ワークツリー作成、Issueコンテキスト付きエージェント起動を一括で実行：

```
Orchestrator:
  dispatch_issue(issue_number: 270)  → .claude/worktrees/270-feat-retry-logic/ にエージェント起動
  dispatch_issue(issue_number: 271)  → .claude/worktrees/271-fix-branch-label/ にエージェント起動
  dispatch_issue(issue_number: 272)  → .claude/worktrees/272-docs-orchestration/ にエージェント起動
  dispatch_issue(issue_number: 273)  → .claude/worktrees/273-fix-worktree-race/ にエージェント起動
```

各サブエージェントは隔離されたブランチで作業 — エージェント間のコンフリクトなし。

### Step 3: 進捗の監視

オーケストレーターがサブエージェントのステータスとCI結果を追跡：

```
Orchestrator: list_agents
  → Agent 270  Processing (feat: retry logic)
  → Agent 271  Idle (fix: branch label) — 完了した可能性あり
  → Agent 272  Processing (docs: orchestration)
  → Agent 273  Processing (fix: worktree race)

Orchestrator: get_ci_status(branch: "271-fix-branch-label-overlap")
  → ✅ 全チェック通過

Orchestrator: get_ci_status(branch: "270-feat-retry-logic")
  → ❌ test_reconnect_timeout 失敗
```

### Step 4: CI失敗の対処

CIが失敗した場合、オーケストレーターがサブエージェントに修正指示を送信：

```
Orchestrator: get_ci_failure_log(branch: "270-feat-retry-logic")
  → test_reconnect_timeout: assertion failed, expected 3 retries got 0

Orchestrator: send_prompt(id: "agent-270", prompt: "CI failed: test_reconnect_timeout expects 3 retries. Fix the test or implementation.")
  → Prompt queued（エージェントがProcessing中、Idleになったら配信）
```

環境起因の失敗（タイムアウト、フレーキーテスト）の場合は、CIを直接再実行：

```
Orchestrator: rerun_ci(branch: "270-feat-retry-logic")
  → CI再実行をトリガー
```

### Step 5: マージ & クリーンアップ

PRがCIを通過したら：

```
Orchestrator:
  → gh pr merge 275 --squash    （Issue #271のPR）
  → delete_worktree(worktree_name: "271-fix-branch-label-overlap")
  → gh pr merge 276 --squash    （Issue #270のPR）
  → delete_worktree(worktree_name: "270-feat-retry-logic")
```

依存関係に注意してマージ — 重複するファイルを触るPRは、先にベースをマージ。

### Step 6: ループの継続

オーケストレーターは以下を続行可能：

- バックログからさらにIssueをディスパッチ
- セッション中に発見した新しいIssueを作成
- Dependabotアラート、リリース、ドキュメント対応
- アーキテクチャの調査・計画

## オーケストレーター設定

`~/.config/tmai/config.toml` でオーケストレーターを設定：

```toml
[orchestrator]
enabled = true
role = "You are an orchestrator agent managing a team of AI coding agents..."

[orchestrator.rules]
branch = "Create feature branches from main"
merge = "Squash merge all PRs"
review = "Check CI passes before merging"
custom = "Run cargo fmt and cargo clippy before committing"

[orchestrator.notify]
on_idle = true           # サブエージェントがIdleになったら通知
on_ci = true             # CIステータス変更時に通知
on_pr_comment = true     # PRレビューコメント時に通知
on_pr_created = true     # PR作成時に通知

pr_monitor_enabled = true
pr_monitor_interval_secs = 60
```

`[[projects]]` によるプロジェクト別オーバーライドも可能：

```toml
[[projects]]
path = "/home/user/myproject"

[projects.orchestrator]
enabled = true
rules.custom = "This project uses npm, not cargo"
```

## オーケストレーター-エージェント間通信

### `send_prompt` — 一方向の指示

オーケストレーターは `send_prompt` でサブエージェントに指示を送信：

```
send_prompt(id: "agent-270", prompt: "CI failed on test_foo. Please fix.")
```

**エージェントステータスごとの動作：**

| エージェントステータス | 動作 |
|----------------------|------|
| Idle | 即座に送信（エージェントが作業開始） |
| Processing | キューに追加（Idleになったら配信） |
| AwaitingApproval | キューに追加（承認完了後に配信） |
| Offline | 即座に送信（再起動を試行） |

**制限事項：**
- 一方向のみ — オーケストレーターはサブエージェントの応答を直接読めない
- `get_agent_output` や `get_transcript` でエージェントの動作を確認
- キュー上限: エージェントあたり5プロンプト（超過分は破棄）

## リカバリーフロー

オーケストレーターエージェントが誤って終了された場合（ターミナルを閉じた等）：

```bash
# 1. Claude Codeを再起動
claude

# 2. 前回のセッションを復元
/resume

# 3. オーケストレーターとして再登録（MCPツール）
set_orchestrator(id: "your-agent-id")
```

`set_orchestrator` ツールは復元されたエージェントをオーケストレーターとしてマークし、サブエージェントからの通知を再有効化します。同プロジェクトの以前のオーケストレーターは自動的に降格されます。

## 実例

ドッグフーディングセッション（2026-04-05）で完全なサイクルを実証：

| 活動 | 詳細 |
|------|------|
| ディスパッチしたIssue | 4件（ワークツリーエージェントに並列） |
| 検出したCI失敗 | 1件（タイムアウト、コードの問題ではない） |
| リカバリーアクション | `send_prompt` → エージェントがタイムアウトと診断 → `rerun_ci` |
| マージしたPR | 4件（全てオーケストレーター経由） |
| クリーンアップしたワークツリー | 4件（`delete_worktree` 経由） |
| オーケストレーター復旧 | kill → `/resume` → `set_orchestrator` |

主な所見：

1. **並列性** — 4エージェントが同時に実装、オーケストレーターが監視
2. **自律的な障害対応** — エージェントがCIタイムアウトを環境問題と診断（コードバグではない）
3. **フルライフサイクル** — Issue → ワークツリー → エージェント → PR → CI → マージ → クリーンアップ、全てMCPツール経由
4. **耐障害性** — オーケストレーターが誤終了からサブエージェント状態を失わずに復旧

## ヒント

### オーケストレーターのベストプラクティス

- **mainブランチに留まる** — オーケストレーターは調整役、ワークツリーで実装しない
- **`dispatch_issue` を使う** — 手動の `spawn_worktree` + プロンプト構築より簡単で信頼性が高い
- **CIチェックをバッチ処理** — `list_prs` で全PRのステータスを一度に確認し、失敗に対処
- **依存順にマージ** — 重複ファイルを触るPRは先にベースをマージ、他をリベース
- **詳細なIssueを作成** — 根本原因、提案する解決策、変更対象ファイルを含める
- **`additional_instructions` を活用** — Issue本文だけでは不十分な場合に追加コンテキストを渡す

### ディスパッチしない方が良いタスク

以下はオーケストレーターに留めた方が良いタスク：

- アーキテクチャの決定・設計議論
- 本番環境の問題調査
- 外部ツール連携が必要なタスク（Chrome DevTools等）
- リリース管理
- タスク途中でユーザー入力が必要なもの

### コンフリクトの対処

別のPRのマージ後にPRがコンフリクトした場合：

1. `send_prompt` でエージェントにリベースを指示
2. または：コンフリクトを手動解決後にマージ
3. Force pushしてCIを待つ
4. マージ

## 前提条件

- tmai稼働中（`tmai init && tmai`）
- GitHub CLI (`gh`) 認証済み
- tmai SettingsにProjectを登録済み
- Claude Code Hooks設定済み（`tmai init`）
- `[orchestrator]` 設定（`~/.config/tmai/config.toml`、オプションだが推奨）

## 次のステップ

- [MCPサーバー](../features/mcp-server.md) — 利用可能なMCPツールの全リスト
- [ワークツリーで並列開発](./worktree-parallel.md) — 低レベルのワークツリーセットアップ
- [マルチエージェント監視](./multi-agent.md) — ダッシュボード監視と操作
