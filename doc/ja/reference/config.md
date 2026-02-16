# 設定リファレンス

tmaiの完全な設定オプション。

## 設定ファイルの場所

```
~/.config/tmai/config.toml
```

ファイルが存在しない場合、tmaiはデフォルト値を使用します。

## 完全な例

```toml
[web]
enabled = true
port = 9876

[exfil_detection]
enabled = true
additional_commands = ["custom-upload", "my-sync"]

[teams]
enabled = true
scan_interval = 5

[auto_approve]
enabled = true
model = "haiku"
```

## セクション

### [web]

Web Remote Controlの設定。

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `enabled` | bool | `true` | Webサーバーの有効/無効 |
| `port` | integer | `9876` | HTTPサーバーのポート |

#### 例

Webサーバーを無効化：

```toml
[web]
enabled = false
```

別のポートを使用：

```toml
[web]
port = 8080
```

### [exfil_detection]

外部送信検知の設定（PTYラップモードのみ）。

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `enabled` | bool | `true` | 外部送信検知の有効/無効 |
| `additional_commands` | string[] | `[]` | 追加で検知するコマンド |

#### 例

外部送信検知を無効化：

```toml
[exfil_detection]
enabled = false
```

カスタムコマンドを追加：

```toml
[exfil_detection]
additional_commands = ["custom-upload", "internal-sync", "deploy-tool"]
```

### [teams]

Agent Teamsの統合設定（実験的機能）。

| キー | 型 | デフォルト | 説明 |
|-----|-----|---------|------|
| `enabled` | bool | `true` | チームスキャンの有効/無効 |
| `scan_interval` | integer | `5` | スキャン間隔（ポーリング周期数、デフォルトのポーリングレートで約2.5秒） |

#### 例

チームスキャンを無効化：

```toml
[teams]
enabled = false
```

スキャン頻度を上げる：

```toml
[teams]
scan_interval = 2
```

### [auto_approve]

AIを使って安全なエージェント操作を自動承認する機能。`claude` CLIが必要。

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

#### 例

デフォルトで有効化：

```toml
[auto_approve]
enabled = true
```

ファイル操作のみ自動承認：

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "file_create"]
```

詳細は [Auto-Approve](../features/auto-approve.md) を参照。

## 環境変数

### RUST_LOG

ログの詳細度を制御：

```bash
# info以上を表示
RUST_LOG=info tmai

# debugメッセージを表示
RUST_LOG=debug tmai

# 警告のみ表示
RUST_LOG=warn tmai
```

### TMAI_CONFIG

設定ファイルの場所を上書き：

```bash
TMAI_CONFIG=/path/to/config.toml tmai
```

## コマンドラインオプション

| オプション | 説明 |
|--------|-------------|
| `--debug` | デバッグモードを有効化（詳細ログ） |
| `--version` | バージョンを表示 |
| `--help` | ヘルプを表示 |

### サブコマンド

| コマンド | 説明 |
|---------|------|
| `tmai` | TUIモニターを起動 |
| `tmai wrap <command>` | PTYラッピングでエージェントを起動 |

#### wrapの例

```bash
# 基本
tmai wrap claude

# 引数付き（コマンド全体をクォート）
tmai wrap "claude --dangerously-skip-permissions"

# 他のエージェント
tmai wrap codex
tmai wrap gemini
```

## デフォルト値まとめ

| 設定 | デフォルト |
|------|---------|
| `web.enabled` | `true` |
| `web.port` | `9876` |
| `exfil_detection.enabled` | `true` |
| `exfil_detection.additional_commands` | `[]` |
| `teams.enabled` | `true` |
| `teams.scan_interval` | `5` |
| `auto_approve.enabled` | `false` |
| `auto_approve.model` | `"haiku"` |
| `auto_approve.timeout_secs` | `30` |
| `auto_approve.cooldown_secs` | `10` |
| `auto_approve.check_interval_ms` | `1000` |
| `auto_approve.max_concurrent` | `3` |
| `auto_approve.allowed_types` | `[]` |

## 設定ファイル形式

tmaiはTOML形式を使用。基本構文：

```toml
# コメント
[section]
key = "文字列値"
number = 123
boolean = true
list = ["item1", "item2"]
```

## 設定の再読み込み

設定は起動時に読み込まれます。変更を適用するにはtmaiを再起動してください。

## トラブルシューティング

### 設定が適用されない

1. ファイルの場所を確認：`~/.config/tmai/config.toml`
2. TOML構文を確認（末尾カンマなし、適切なクォート）
3. 変更後にtmaiを再起動

### 権限エラー

設定ファイルが読み取り可能か確認：

```bash
chmod 644 ~/.config/tmai/config.toml
```

## 次のステップ

- [Web APIリファレンス](./web-api.md) - REST APIドキュメント
- [キーバインド一覧](./keybindings.md) - キーボードショートカット
