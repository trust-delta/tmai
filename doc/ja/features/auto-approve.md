# Auto-Approve（自動承認）

AIを使って安全なエージェント操作を自動承認する機能。

## 概要

Auto-approveは、AIモデル（デフォルト: Claude Haiku）を使用して、AIエージェントの承認待ちプロンプトが安全に自動承認できるかを判定します。ファイル読み取り、テスト実行、コードフォーマットなどのルーチン的で低リスクな操作を手動で承認する手間を省きます。

**注意**: この機能には `claude` CLIのインストールと認証が必要です。

## 仕組み

```
エージェントが AwaitingApproval に入る
  ↓ （約1秒のチェック間隔）
Auto-approveサービスが候補を検出
  ↓ 画面コンテキストをAIに送信
  ├─ Approve   → 承認キーを自動送信
  ├─ Reject    → 手動操作が必要（ユーザーが対応）
  └─ Uncertain → 手動操作が必要（ユーザーが対応）
```

サービスの動作:

1. `AwaitingApproval` 状態のエージェントを**スキャン**
2. AI判定が不要な候補を**フィルタリング**（本物のユーザー質問、auto-approveモードのエージェント等）
3. ターミナル出力の末尾30行をAIモデルにコンテキストとして**送信**
4. AIの判定結果を**適用** — approve、reject、uncertain
5. 現在の判定フェーズをUIに**表示**

## UI表示

### TUI

| フェーズ | インジケータ | 色 | ラベル |
|---------|------------|-----|-------|
| 判定中（AI思考中） | `⟳` | Cyan | `Judging: File Edit` |
| 承認済み（キー送信済み） | `✓` | Green | `Approved: File Edit` |
| 手動操作必要 | `⚠` | Magenta | `Awaiting: File Edit` |

### Web UI

- **判定中**: 青色バッジ「AI judging...」
- **承認済み**: 緑色バッジ「Approved」（状態遷移前に一瞬表示）
- **手動操作必要**: 通常の承認ボタン（Approve / Reject）

## 設定

`~/.config/tmai/config.toml`:

```toml
[auto_approve]
enabled = true              # Auto-approveを有効化（デフォルト: false）
model = "haiku"             # 判定に使うAIモデル（デフォルト: "haiku"）
timeout_secs = 30           # 判定のタイムアウト（デフォルト: 30）
cooldown_secs = 10          # 判定後のクールダウン（デフォルト: 10）
check_interval_ms = 1000    # チェック間隔（ms）（デフォルト: 1000）
max_concurrent = 3          # 最大同時判定数（デフォルト: 3）
allowed_types = []          # 承認タイプフィルタ（デフォルト: [] = 全タイプ）
```

### 設定オプション

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `enabled` | bool | `false` | Auto-approveの有効/無効 |
| `provider` | string | `"claude_haiku"` | 判定プロバイダー |
| `model` | string | `"haiku"` | `claude --model` に渡すモデル名 |
| `timeout_secs` | integer | `30` | 各判定のタイムアウト秒数 |
| `cooldown_secs` | integer | `10` | 同一エージェントの再評価までの待ち時間 |
| `check_interval_ms` | integer | `1000` | 候補スキャンの間隔（ms） |
| `max_concurrent` | integer | `3` | 最大並列判定数 |
| `allowed_types` | string[] | `[]` | 自動承認する承認タイプ（空 = 本物のユーザー質問以外すべて） |
| `custom_command` | string | `null` | `claude` の代わりに使うカスタムコマンド |

### 承認タイプでフィルタリング

特定の承認タイプのみ自動承認する:

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "shell_command"]
```

利用可能なタイプ: `file_edit`, `file_create`, `file_delete`, `shell_command`, `mcp_tool`, `user_question`

## 安全性ルール

AIジャッジは以下のルールに従います:

### 承認する場合（すべて該当時）:
- 読み取り専用、または明示的に低リスクな操作（ファイル読み取り、ディレクトリ一覧、テスト実行、コードフォーマット等）
- ビルド破壊やデータ削除につながるファイル変更がない
- 権限昇格がない（`sudo`、`chmod 777` 等）
- ネットワーク/データ流出リスクがない
- コマンドインジェクションや信頼できない入力の兆候がない
- 現在の開発タスクに明らかに関連している

### 拒否する場合（いずれか該当時）:
- 破壊的操作（`rm -rf`、`DROP TABLE`、force push等）
- プロジェクト外のシステムファイルや設定への書き込み
- 機密データを含む外部サービスへのネットワークリクエスト
- 権限昇格の試み
- 疑わしい操作や開発と無関係な操作

### 不確定（手動にフォールバック）:
- AIが安全性を確信できない場合

## スキップされるケース

以下はAI判定に送られません:

| 理由 | 説明 |
|------|------|
| **本物のユーザー質問** | カスタム選択肢を持つ `AskUserQuestion`（標準的なYes/Noではないもの） |
| **複数選択プロンプト** | 複数選択が必要な質問 |
| **Auto-approveモードのエージェント** | `--dangerously-skip-permissions` モードのエージェント |
| **仮想エージェント** | 物理ペインを持たないエージェント |
| **allowed_typesに含まれない** | `allowed_types` 設定時にタイプが一致しない場合 |

## 監査ログ

`--audit` 有効時、各判定が `AutoApproveJudgment` イベントとして記録されます:

```json
{
  "event": "AutoApproveJudgment",
  "ts": 1708123456789,
  "pane_id": "main:0.1",
  "agent_type": "claude_code",
  "approval_type": "file_edit",
  "decision": "approve",
  "reasoning": "Reading a test file is a safe, read-only operation",
  "model": "haiku",
  "elapsed_ms": 3200,
  "approval_sent": true
}
```

監査ログのクエリ:

```bash
# 全auto-approve判定
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment")'

# 拒否されたアクション
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and .decision == "reject")'

# 平均判定時間
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment") | .elapsed_ms' | awk '{sum+=$1; n++} END {print sum/n "ms"}'
```

## トラブルシューティング

### Auto-approveが動作しない

1. 設定で `enabled = true` になっているか確認
2. `claude` CLIがインストールされているか確認: `which claude`
3. 認証が通っているか確認: `claude --version`
4. `--debug` フラグでログを確認

### 判定が常に "uncertain" になる

1. `timeout_secs` を確認 — タイムアウトしている場合は値を増やす
2. モデル名が正しいか確認（デフォルト: `haiku`）
3. デバッグログでstderr出力を確認

### エージェントが "Judging" のまま固まる

`cooldown_secs` 設定により再評価が抑制されます。固まったように見える場合:

1. tmaiから手動で承認/拒否（`y`キーまたはWeb UI）
2. エージェントが `AwaitingApproval` から遷移するとフェーズは自動クリアされます

## 設定例

### ミニマル（安全なものをすべて承認）

```toml
[auto_approve]
enabled = true
```

### 保守的（ファイル操作のみ）

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "file_create"]
timeout_secs = 15
```

### 高速イテレーション（短いクールダウン）

```toml
[auto_approve]
enabled = true
cooldown_secs = 5
check_interval_ms = 500
max_concurrent = 5
```

## 次のステップ

- [設定リファレンス](../reference/config.md) - 設定オプション一覧
- [外部送信検知](./exfil-detection.md) - セキュリティ監視
- [Web Remote Control](./web-remote.md) - リモート承認のフォールバック
