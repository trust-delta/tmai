# 外部送信検知

AIエージェントによる外部データ送信のセキュリティ監視。

## 概要

外部送信検知は、PTYラップモードでAIエージェントの出力を監視し、外部送信コマンドや機密データパターンを検出してログに記録します。

**注意**: この機能にはPTYラッピングモード（`tmai wrap`）が必要です。

## 設定

`~/.config/tmai/config.toml`:

```toml
[exfil_detection]
enabled = true                          # デフォルト: true
additional_commands = ["custom-upload"] # カスタムコマンドを追加
```

## 検出コマンド

### 組み込みコマンド

| カテゴリ | コマンド |
|----------|----------|
| HTTP | `curl`, `wget`, `httpie`, `http` |
| ネットワーク | `nc`, `netcat`, `ncat`, `socat`, `telnet` |
| ファイル転送 | `scp`, `sftp`, `rsync`, `ftp` |
| クラウドCLI | `aws`, `gcloud`, `az`, `gsutil` |
| その他 | `ssh`, `git push`, `npm publish`, `cargo publish` |

### カスタムコマンド

独自のコマンドを追加して検出：

```toml
[exfil_detection]
additional_commands = ["custom-sync", "my-upload-tool"]
```

## 機密データパターン

送信コマンドで以下のパターンが検出されるとフラグが立ちます：

| パターン | 例 |
|---------|---------|
| OpenAI APIキー | `sk-...` |
| Anthropic APIキー | `sk-ant-...` |
| GitHubトークン | `ghp_...`, `gho_...`, `ghs_...` |
| AWSアクセスキー | `AKIA...` |
| Google APIキー | `AIza...` |
| Slackトークン | `xox...` |
| Bearerトークン | `Bearer ...` |
| 秘密鍵 | `-----BEGIN PRIVATE KEY-----` |
| 汎用APIキー | `api_key=...`, `apikey=...` |

## ログ出力

### 外部送信検出

```
INFO  External transmission detected command="curl" pid=12345
```

### 機密データを含む送信

```
WARN  Sensitive data in transmission command="curl" sensitive_type="API Key" pid=12345
```

## ログレベル

| 状況 | レベル | メッセージ |
|------|--------|---------|
| 外部送信コマンド | `info` | `External transmission detected` |
| 機密データを含む送信 | `warn` | `Sensitive data in transmission` |

## ログの確認

詳細なログには`--debug`フラグを使用：

```bash
tmai --debug
```

または環境変数でログレベルを設定：

```bash
RUST_LOG=info tmai
```

## この機能がしないこと

- **送信のブロック** - 検出のみ、防止はしない
- **送信データのキャプチャ** - 送信が発生したことのみ記録
- **非PTYセッションの監視** - PTYラッピングが必要

## ユースケース

1. **監査証跡** - エージェントがどの外部呼び出しを行ったか追跡
2. **セキュリティ意識** - エージェントがデータ流出を試みた際に気づく
3. **インシデント調査** - 疑わしい活動後にログを確認

## 制限事項

- コマンドラインパターンのみ検出、ライブラリレベルのHTTP呼び出しは検出不可
- 機密データ検出はパターンマッチング、偽陽性/偽陰性の可能性あり
- 暗号化または難読化された送信は検出不可

## シナリオ例

### シナリオ1: 通常のAPI呼び出し

```
$ curl https://api.example.com/data
```

ログ: `INFO External transmission detected command="curl" pid=12345`

### シナリオ2: 誤ったキー露出

```
$ curl -H "Authorization: Bearer sk-ant-xxx" https://api.example.com
```

ログ: `WARN Sensitive data in transmission command="curl" sensitive_type="Anthropic API Key" pid=12345`

## 次のステップ

- [PTYラッピング](./pty-wrapping.md) - 外部送信検知に必要
- [設定リファレンス](../reference/config.md) - 全設定オプション
