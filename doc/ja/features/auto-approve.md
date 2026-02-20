# Auto-Approve（自動承認）

4つの動作モードで安全なエージェント操作を自動承認する機能。

## 概要

Auto-approveは4つのモードをサポートし、速度・精度・コストのバランスを取ります:

| モード | 説明 | 速度 | `claude` CLI必要 |
|--------|------|------|-----------------|
| **Off** | 自動承認なし（デフォルト） | — | 不要 |
| **Rules** | パターンベースの即時承認 | サブミリ秒 | 不要 |
| **AI** | AIモデルが各プロンプトを判定 | 約2-15秒 | 必要 |
| **Hybrid** | ルール優先、不明時にAIフォールバック | 一般操作は高速 | 必要 |

**Rulesモード**はClaude Codeの承認プロンプトを組み込みパターン（読み取り操作、テスト実行、git読み取りコマンド等）と照合し、AI呼び出しなしで即時承認します。

**AIモード**は画面コンテキストをAIモデル（デフォルト: Claude Haiku）に送信して判定します。最も正確ですが最も遅い選択肢です。

**Hybridモード**（推奨）はまずルールを試し、マッチしない場合にAI判定にフォールバックします。一般的な操作には即時承認を提供しつつ、それ以外にもAIカバレッジを維持します。

## 仕組み

### Rulesモード

```
エージェントが AwaitingApproval に入る
  ↓ （即時、サブミリ秒）
ルールエンジンが承認プロンプトを解析
  ├─ Allowルールにマッチ → 承認キーを自動送信
  └─ マッチなし           → 手動操作が必要
```

### AIモード

```
エージェントが AwaitingApproval に入る
  ↓ （約1秒のチェック間隔）
画面コンテキストをAIに送信
  ├─ Approve   → 承認キーを自動送信
  ├─ Reject    → 手動操作が必要
  └─ Uncertain → 手動操作が必要
```

### Hybridモード

```
エージェントが AwaitingApproval に入る
  ↓ （即時）
ルールエンジンがまず評価
  ├─ Allowルールにマッチ → 即時承認
  └─ マッチなし → AIフォールバック
                    ├─ Approve   → 承認
                    ├─ Reject    → 手動操作必要
                    └─ Uncertain → 手動操作必要
```

## 組み込みAllowルール

ルールエンジンはClaude Codeの承認プロンプト形式を認識し、以下のカテゴリと照合します:

| ルール | 設定 | マッチ対象 |
|--------|------|-----------|
| **読み取り操作** | `allow_read` | `Read`ツール、`cat`, `head`, `tail`, `ls`, `find`, `grep`, `wc` |
| **テスト実行** | `allow_tests` | `cargo test`, `npm test`, `pytest`, `go test`, `dotnet test` 等 |
| **フェッチ/検索** | `allow_fetch` | `WebFetch`, `WebSearch`, `curl` GET（POST/dataなし） |
| **Git読み取り専用** | `allow_git_readonly` | `git status/log/diff/branch/show/blame/stash list/remote -v/tag/rev-parse/ls-files/ls-tree` |
| **フォーマット/リント** | `allow_format_lint` | `cargo fmt/clippy`, `prettier`, `eslint`, `rustfmt`, `black`, `gofmt`, `biome` 等 |
| **カスタムパターン** | `allow_patterns` | ユーザー定義の正規表現パターン |

すべての組み込みルールはデフォルトで有効です。どのルールにもマッチしない操作は手動承認（Rulesモード）またはAI判定（Hybridモード）に回されます。

## UI表示

### TUI

| フェーズ | インジケータ | 色 | ラベル |
|---------|------------|-----|-------|
| 判定中（AI思考中） | `⟳` | Cyan | `Judging: File Edit` |
| ルール承認 | `✓` | Green | `Rule-Approved: File Edit` |
| AI承認 | `✓` | Green | `AI-Approved: File Edit` |
| 手動操作必要 | `⚠` | Magenta | `Awaiting: File Edit` |

### Web UI

- **判定中**: 青色バッジ「AI judging...」
- **ルール承認**: 緑色バッジ「Rule-Approved」
- **AI承認**: 緑色バッジ「AI-Approved」
- **手動操作必要**: 通常の承認ボタン（Approve / Reject）

## 設定

`~/.config/tmai/config.toml`:

```toml
[auto_approve]
mode = "hybrid"             # 動作モード: off/rules/ai/hybrid
model = "haiku"             # 判定に使うAIモデル（AI/Hybridモード）

[auto_approve.rules]
allow_read = true           # 読み取り操作を自動承認
allow_tests = true          # テスト実行を自動承認
allow_fetch = true          # WebFetch/WebSearchを自動承認
allow_git_readonly = true   # 読み取り専用gitコマンドを自動承認
allow_format_lint = true    # フォーマット/リントコマンドを自動承認
allow_patterns = []         # 追加のAllowパターン（正規表現）
```

### モード設定

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `mode` | string | — | 動作モード: `"off"`, `"rules"`, `"ai"`, `"hybrid"` |
| `enabled` | bool | `false` | レガシートグル（`mode` を推奨） |

**後方互換性**: `mode` が未設定の場合、`enabled` フィールドにフォールバック — `enabled = true` はAIモード、`enabled = false` はOffに対応。

### ルール設定 (`[auto_approve.rules]`)

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `allow_read` | bool | `true` | Readツールと読み取り専用シェルコマンドを自動承認 |
| `allow_tests` | bool | `true` | テスト実行を自動承認（cargo test, npm test 等） |
| `allow_fetch` | bool | `true` | WebFetch, WebSearch, curl GETを自動承認 |
| `allow_git_readonly` | bool | `true` | 読み取り専用gitコマンドを自動承認 |
| `allow_format_lint` | bool | `true` | フォーマット/リントコマンドを自動承認 |
| `allow_patterns` | string[] | `[]` | 追加のAllow正規表現パターン |

### AI設定

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `model` | string | `"haiku"` | `claude --model` に渡すモデル名 |
| `timeout_secs` | integer | `30` | 各AI判定のタイムアウト秒数 |
| `cooldown_secs` | integer | `10` | 同一エージェントの再評価までの待ち時間 |
| `check_interval_ms` | integer | `1000` | 候補スキャンの間隔（ms） |
| `max_concurrent` | integer | `3` | 最大並列AI判定数 |
| `allowed_types` | string[] | `[]` | 自動承認する承認タイプ（空 = 本物のユーザー質問以外すべて） |
| `custom_command` | string | `null` | `claude` の代わりに使うカスタムコマンド |

### カスタムAllowパターン

追加の正規表現パターンで操作を許可:

```toml
[auto_approve.rules]
allow_patterns = [
    "my-safe-tool",           # プロンプト内の任意の位置でマッチ
    "^Allow Bash: make ",     # makeで始まるコマンド
]
```

## 安全性

### ルールエンジン

ルールエンジンには**Allowルールのみ**があり、Denyルールはありません。どのAllowルールにもマッチしない操作は手動承認（Rulesモード）またはAI判定（Hybridモード）に回されます。このフェイルセーフ設計により、未知の操作は必ず明示的な承認が必要になります。

### AIジャッジ

**承認する場合**（すべて該当時）:
- 読み取り専用、または明示的に低リスクな操作
- ビルド破壊やデータ削除につながる変更がない
- 権限昇格がない（`sudo`、`chmod 777` 等）
- ネットワーク/データ流出リスクがない

**拒否する場合**（いずれか該当時）:
- 破壊的操作（`rm -rf`、`DROP TABLE`、force push等）
- プロジェクト外のシステムファイルへの書き込み
- 機密データを含むネットワークリクエスト
- 権限昇格の試み

**不確定**（手動にフォールバック）:
- AIが安全性を確信できない場合

## スキップされるケース

以下は判定に送られません:

| 理由 | 説明 |
|------|------|
| **本物のユーザー質問** | カスタム選択肢を持つ `AskUserQuestion` |
| **複数選択プロンプト** | 複数選択が必要な質問 |
| **Auto-approveモードのエージェント** | `--dangerously-skip-permissions` モードのエージェント |
| **仮想エージェント** | 物理ペインを持たないエージェント |
| **allowed_typesに含まれない** | `allowed_types` 設定時にタイプが一致しない場合 |

## 監査ログ

`--audit` 有効時、各判定が `AutoApproveJudgment` イベントとして記録されます。`model` フィールドでルール承認とAI承認を区別できます:

```json
{
  "event": "AutoApproveJudgment",
  "pane_id": "main:0.1",
  "decision": "approve",
  "model": "rules:allow_read",
  "elapsed_ms": 0,
  "approval_sent": true
}
```

```json
{
  "event": "AutoApproveJudgment",
  "pane_id": "main:0.1",
  "decision": "approve",
  "model": "haiku",
  "elapsed_ms": 3200,
  "approval_sent": true
}
```

監査ログのクエリ:

```bash
# 全auto-approve判定
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment")'

# ルール承認のみ
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and (.model | startswith("rules:")))'

# AI承認のみ
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and (.model | startswith("rules:") | not))'
```

## トラブルシューティング

### Auto-approveが動作しない

1. `mode` 設定を確認（またはレガシーの `enabled = true`）
2. AI/Hybridモード: `claude` CLIがインストールされているか確認（`which claude`）
3. AI/Hybridモード: 認証が通っているか確認（`claude --version`）
4. `--debug` フラグでログを確認

### ルールが期待するコマンドにマッチしない

1. 該当するallow設定が `true` か確認（デフォルトはすべて `true`）
2. `--audit` ログで解析されたoperation/targetを確認
3. 非標準コマンドには `allow_patterns` でカスタム正規表現を追加

### エージェントが "Judging" のまま固まる

`cooldown_secs` 設定により再評価が抑制されます。固まったように見える場合:

1. tmaiから手動で承認/拒否（`y`キーまたはWeb UI）
2. エージェントが `AwaitingApproval` から遷移するとフェーズは自動クリアされます

## 設定例

### ルールのみ（AI不使用、即時、無料）

```toml
[auto_approve]
mode = "rules"
```

### ハイブリッド（推奨）

```toml
[auto_approve]
mode = "hybrid"
model = "haiku"
```

### AIのみ（最も正確、低速）

```toml
[auto_approve]
mode = "ai"
```

### 保守的ルール（読み取りのみ）

```toml
[auto_approve]
mode = "rules"

[auto_approve.rules]
allow_tests = false
allow_fetch = false
allow_format_lint = false
```

### レガシー互換

```toml
[auto_approve]
enabled = true   # mode = "ai" と同等
```

## 次のステップ

- [設定リファレンス](../reference/config.md) - 設定オプション一覧
- [外部送信検知](./exfil-detection.md) - セキュリティ監視
- [Web Remote Control](./web-remote.md) - リモート承認のフォールバック
