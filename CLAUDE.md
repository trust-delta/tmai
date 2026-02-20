# tmai (Tmux Multi Agent Interface)

tmux上で複数のAIエージェント（Claude Code、Codex CLI、Gemini CLI）を監視・操作するためのRustツール。

## 目的と特徴

AIエージェントのターミナル監視ツールとして、以下の機能を提供する：

- **高精度な状態検出**: 確認ダイアログ、AskUserQuestion、エラー状態を正確に判定
- **PTYラッピング**: 入出力をリアルタイム監視し、従来のcapture-paneより高精度に状態を検知
- **AskUserQuestion対応**: 番号キーで選択肢を直接選択、複数選択（multi_select）にも対応
- **リッチなプレビュー**: tmuxペインの内容をリアルタイム表示
- **Web Remote Control**: スマホからQRコード経由で承認操作が可能
- **検出ソース表示**: PTY検出（高精度）かcapture-pane検出かをステータスバーに表示
- **Agent Teams対応**: Claude Code Agent Teamsのチーム構造・タスク進捗を可視化
- **モード検出**: Plan/Delegate/AutoApproveモードをタイトルアイコンから自動検出・表示
- **検出監査ログ**: 判定理由付きndjsonログで検出精度を検証可能（`--audit` フラグで有効化）
- **Auto-approve**: ルール/AI/ハイブリッドの4モードで安全な操作を自動承認

## ディレクトリ構成

```
tmai/
├── Cargo.toml
├── CLAUDE.md
├── src/
│   ├── main.rs                 # エントリポイント、CLI
│   ├── lib.rs
│   ├── agents/                 # エージェント定義
│   │   ├── mod.rs
│   │   ├── types.rs            # AgentType, AgentStatus, ApprovalType, DetectionSource
│   │   └── subagent.rs
│   ├── audit/                  # 検出監査ログ
│   │   ├── mod.rs
│   │   ├── events.rs           # AuditEvent enum
│   │   └── logger.rs           # ndjsonロガー + ローテーション
│   ├── auto_approve/           # 自動承認（Off/Rules/AI/Hybrid 4モード）
│   │   ├── mod.rs
│   │   ├── types.rs            # AutoApproveMode, AutoApprovePhase, JudgmentRequest/Result
│   │   ├── service.rs          # AutoApproveService（メインループ、モード分岐）
│   │   ├── rules.rs            # RuleEngine（パターンベース即時判定）
│   │   └── judge.rs            # ClaudeHaikuJudge（AI判定プロバイダー）
│   ├── detectors/              # 状態検出
│   │   ├── mod.rs              # StatusDetector trait, DetectionResult/Reason
│   │   ├── claude_code.rs      # Claude Code専用検出器
│   │   ├── codex.rs
│   │   ├── gemini.rs
│   │   └── default.rs
│   ├── tmux/                   # tmux連携
│   │   ├── mod.rs
│   │   ├── client.rs           # tmux CLI wrapper
│   │   ├── pane.rs             # PaneInfo
│   │   └── process.rs          # プロセスキャッシュ
│   ├── monitor/
│   │   ├── mod.rs
│   │   └── poller.rs           # 非同期ポーリング
│   ├── state/
│   │   ├── mod.rs
│   │   └── store.rs            # AppState
│   ├── ui/
│   │   ├── mod.rs
│   │   ├── app.rs              # メインループ
│   │   ├── layout.rs           # ViewMode, SplitDirection
│   │   └── components/
│   │       ├── mod.rs
│   │       ├── session_list.rs     # エージェント一覧（縦/横表示対応）
│   │       ├── pane_preview.rs
│   │       ├── status_bar.rs
│   │       ├── help_screen.rs      # フルスクリーンヘルプ
│   │       ├── selection_popup.rs  # AskUserQuestion用
│   │       ├── confirmation_popup.rs
│   │       ├── create_process_popup.rs  # 新規プロセス作成ウィザード
│   │       ├── qr_screen.rs        # QRコード画面
│   │       ├── task_overlay.rs     # チームタスクオーバーレイ
│   │       └── team_overview.rs    # チーム一覧画面
│   ├── teams/                  # Agent Teams検出
│   │   ├── mod.rs
│   │   ├── config.rs           # チーム設定読み込み
│   │   ├── task.rs             # タスク読み込み
│   │   └── scanner.rs          # チームスキャナー
│   ├── config/
│   │   ├── mod.rs
│   │   └── settings.rs
│   ├── wrap/                   # PTYラッピング
│   │   ├── mod.rs
│   │   ├── runner.rs           # PTYプロキシ実行
│   │   ├── analyzer.rs         # 出力解析・状態判定
│   │   ├── exfil_detector.rs   # 外部送信検知
│   │   └── state_file.rs       # 状態ファイル読み書き
│   └── web/                    # Web Remote Control
│       ├── mod.rs
│       ├── server.rs           # axum HTTPサーバー
│       ├── api.rs              # REST APIハンドラー
│       ├── events.rs           # SSE（リアルタイム更新）
│       ├── auth.rs             # トークン認証
│       ├── static_files.rs     # 静的ファイル配信
│       └── assets/
│           ├── index.html
│           ├── style.css
│           └── app.js
├── scripts/
│   └── setup-wsl-portforward.ps1  # WSL環境用ポートフォワード設定
└── tests/
```

## 開発コマンド

```bash
cargo run              # 実行
cargo run -- --debug   # デバッグモード
cargo run -- --audit   # 検出監査ログ有効（$STATE_DIR/audit/detection.ndjson）
cargo run -- wrap claude  # PTYラップモードでclaude起動
cargo test             # テスト
cargo clippy           # Lint
cargo fmt              # フォーマット
cargo build --release  # リリースビルド
```

## 対応エージェント

| Agent | 検出方法 | 承認キー |
|-------|----------|----------|
| Claude Code | `claude` コマンド、✳/spinner in title | `y` (Enter送信) |
| OpenCode | `opencode` コマンド | `y` (Enter送信) |
| Codex CLI | `codex` コマンド | `y` (Enter送信) |
| Gemini CLI | `gemini` コマンド | `y` (Enter送信) |

> **Note**: `n`キーでNo選択（UserQuestion）、他の選択は数字キー、入力モード(`i`)、パススルーモード(`p`)を使用

## キーバインド

| キー | 動作 |
|------|------|
| j/k, ↓/↑ | ナビゲーション |
| y | 承認 / Yesを選択 |
| n | Noを選択（UserQuestionのみ） |
| 1-9 | AskUserQuestion選択 |
| Space | 複数選択トグル |
| Enter | 複数選択確定 |
| i | 入力モード |
| p / → | パススルーモード（直接キー入力） |
| f | ペインにフォーカス |
| x | ペインを終了（確認あり） |
| Tab | ビューモード切り替え (Split/List/Preview) |
| l | 分割方向切り替え (Horizontal/Vertical) |
| s | ソート切り替え (現在無効) |
| m | モニタースコープ切り替え (現在無効) |
| t | タスクオーバーレイ（チームメンバー選択時） |
| T | チーム一覧画面 |
| g | 先頭へ移動 |
| G | 末尾へ移動 |
| r | Web Remote ControlのQRコード表示 |
| h / ? | ヘルプ |
| q / Esc | 終了 |
| Ctrl+d/u | プレビュースクロール |

> **Note**: 全キーが全角入力（IME ON）に対応。パススルーモード・入力モードを除き、全角英数字（ａ-ｚ、Ａ-Ｚ、０-９）および全角スペースは自動的に半角に変換される。

## Claude Code検出器の設計

**検出優先度（4段階）：**
1. **Approval検出**（最高優先度）
   - AskUserQuestion（番号付き選択肢 + カーソルマーカー）
   - Proceed-prompt（番号付きYes/No、カーソルなしフォールバック）
   - Yes/No ボタン形式（4行以内proximity check）
   - `[y/n]` パターン
2. **Error検出**
3. **Title-based検出**
   - `✳` = Idle
   - Braille spinners = Processing

**モード検出（タイトルアイコン）：**

| アイコン | モード | 説明 |
|---------|--------|------|
| ⏸ | Plan | 読み取り専用、ツール実行なし |
| ⇢ | Delegate | 委任モード |
| ⏵⏵ | AutoApprove | acceptEdits/bypassPermissions/dontAsk |
| (なし) | Default | 通常モード |

**検出精度の工夫：**
- `❯` 単独行は選択カーソルとして認識（入力プロンプトと誤認識しない）
- Yes/No検出は行距離チェック付き（無関係な箇所を誤検出しない）
- チェックボックス: `[ ]`, `[x]`, `[X]`, `[×]`, `[✔]` に対応（Windows/macOS/Linux）
- コンテンツスピナー: `✳` を含む全文字に対応（macOS/Ghostty互換）

## Web Remote Control（スマホ連携）

スマホのブラウザからエージェントを操作する機能。QRコードをスキャンしてアクセス。

### 機能
- エージェント一覧表示（リアルタイム更新）
- y/n承認操作
- AskUserQuestion選択肢の選択
- 複数選択（multi_select）対応
- テキスト入力送信
- ペインプレビュー表示（5秒自動更新）
- ダーク/ライトテーマ切り替え
- 状態変化時のトースト通知

### 設定（~/.config/tmai/config.toml）

```toml
[web]
enabled = true  # Webサーバーを有効化（デフォルト: true）
port = 9876     # ポート番号（デフォルト: 9876）

[teams]
enabled = true       # チーム検出を有効化（デフォルト: true）
scan_interval = 5    # スキャン間隔（ポーリング周期数、デフォルト: 5 ≒ 2.5秒）

[audit]
enabled = false               # 検出監査ログ（デフォルト: false、--audit フラグでも有効化可）
max_size_bytes = 10485760     # ログファイル最大サイズ（デフォルト: 10MB、超過でローテーション）
log_source_disagreement = false  # IPC/capture-pane不一致イベントの記録

[auto_approve]
mode = "hybrid"              # 動作モード: off/rules/ai/hybrid（デフォルト: mode未設定時はenabledで判定）
# enabled = false            # レガシートグル（mode未設定時: true→ai, false→off）
model = "haiku"              # 判定モデル（AI/Hybridモード用、デフォルト: "haiku"）
timeout_secs = 30            # 判定タイムアウト（デフォルト: 30秒）
cooldown_secs = 10           # 同一ターゲットの再評価待ち（デフォルト: 10秒）
check_interval_ms = 1000     # チェック間隔（デフォルト: 1000ms）
max_concurrent = 3           # 最大同時判定数（デフォルト: 3）
allowed_types = []           # 承認タイプフィルタ（空=全タイプ、例: ["file_edit", "shell_command"]）

[auto_approve.rules]
allow_read = true            # 読み取り操作を自動承認（デフォルト: true）
allow_tests = true           # テスト実行を自動承認（デフォルト: true）
allow_fetch = true           # WebFetch/WebSearchを自動承認（デフォルト: true）
allow_git_readonly = true    # 読み取り専用gitコマンドを自動承認（デフォルト: true）
allow_format_lint = true     # フォーマット/リントを自動承認（デフォルト: true）
allow_patterns = []          # 追加のAllowパターン（正規表現）
```

### 使用方法
1. `r`キーでQRコード画面を表示
2. スマホでQRコードをスキャン
3. ブラウザでエージェント一覧が表示される
4. 承認待ちエージェントの「Approve」「Reject」ボタンで操作

### REST API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/agents` | エージェント一覧 |
| POST | `/api/agents/:id/approve` | 承認（y送信） |
| POST | `/api/agents/:id/select` | 選択肢選択 |
| POST | `/api/agents/:id/submit` | 複数選択確定 |
| POST | `/api/agents/:id/input` | テキスト送信 |
| GET | `/api/agents/:id/preview` | ペイン内容取得 |
| GET | `/api/teams` | チーム一覧（タスクサマリー付き） |
| GET | `/api/teams/{name}/tasks` | チームタスク一覧 |
| GET | `/api/events` | SSEストリーム（`agents`, `teams` イベント） |

### セキュリティ
- URLに含まれるランダムトークンで認証
- 同一LAN内からのみアクセス可能

### WSL環境での利用

WSL2のネットワークモードに応じて設定が異なります。

#### Mirrored mode（推奨）

`.wslconfig`に`networkingMode=mirrored`が設定されている場合、WSLとWindowsがネットワークを共有するため、**ポートフォワーディングは不要**です。

**必要な設定: Windowsファイアウォールでポートを許可**

```powershell
# 管理者権限のPowerShellで実行
New-NetFirewallRule -DisplayName "tmai Web Remote" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow
```

#### NAT mode（従来方式）

mirrored modeを使用していない場合、外部デバイスはWSLに直接アクセスできないため、
Windowsでポートフォワーディングの設定が必要です。

```powershell
# 管理者権限のPowerShellで実行
.\scripts\setup-wsl-portforward.ps1

# 削除する場合
.\scripts\setup-wsl-portforward.ps1 -Remove
```

**注意**: NAT modeではWSLのIPがリブートで変わるため、接続できなくなったら再度スクリプトを実行してください。

## PTYラッピング機能

AIエージェントをPTYプロキシ経由で起動し、入出力をリアルタイム監視することで、従来のtmux capture-paneより高精度な状態検知を実現する。

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                        tmai (親)                             │
│  ┌─────────────┐   ┌────────────┐   ┌───────────────────┐  │
│  │   Poller    │◄──│ PtyMonitor │◄──│ $STATE_DIR/*.state│  │
│  └─────────────┘   └────────────┘   └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                              ▲
                                              │ 状態書き込み
┌─────────────────────────────────────────────┴───────────────┐
│                    tmai wrap claude                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  User ←→ PTY Proxy ←→ claude                           │ │
│  │              │                                          │ │
│  │         StateAnalyzer → $STATE_DIR/{pane_id}.state     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 使用方法

```bash
# 手動でラップモードで起動
tmai wrap claude
tmai wrap "claude --dangerously-skip-permissions"
tmai wrap codex
```

### 状態判定ロジック

| 状態 | 判定方法 |
|------|----------|
| Processing | 出力が流れている間（最後の出力から200ms以内） |
| Idle | 出力停止 + プロンプト検出不要 |
| Approval | 出力にYes/No等のパターン + 出力停止後500ms経過 |

### 状態ファイル形式

`$STATE_DIR` = `$XDG_RUNTIME_DIR/tmai`（優先）or `/tmp/tmai-<UID>`（フォールバック）

```
$STATE_DIR/{pane_id}.state
```

```json
{
  "status": "processing|idle|awaiting_approval",
  "approval_type": "file_edit|shell_command|mcp_tool|user_question|yes_no|other",
  "details": "承認内容の説明",
  "choices": ["選択肢1", "選択肢2"],
  "multi_select": false,
  "cursor_position": 1,
  "last_output": 1706745600000,
  "last_input": 1706745590000,
  "pid": 12345,
  "pane_id": "0",
  "team_name": "my-project",
  "team_member_name": "dev",
  "is_team_lead": false
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| status | string | `processing`, `idle`, `awaiting_approval` |
| approval_type | string? | 承認タイプ（status=awaiting_approval時のみ） |
| details | string? | 承認内容の詳細説明 |
| choices | string[] | AskUserQuestionの選択肢 |
| multi_select | bool | 複数選択可能か |
| cursor_position | number | 現在のカーソル位置（1-indexed） |
| last_output | number | 最後の出力タイムスタンプ（Unix ms） |
| last_input | number | 最後の入力タイムスタンプ（Unix ms） |
| pid | number | ラップされたプロセスのPID |
| pane_id | string? | tmuxペインID |
| team_name | string? | チーム名（チームメンバーの場合） |
| team_member_name | string? | チームメンバー名 |
| is_team_lead | bool | チームリーダーか否か |

### 自動ラップ

tmai UIから新規AIプロセスを作成する際、自動的に `tmai wrap` 経由で起動される。

### フォールバック

- 状態ファイルが存在しない場合は従来のcapture-pane方式
- PTYエラー時は即座に従来方式にフォールバック
- 既存セッションは引き続き従来方式で監視

### 外部送信検知（Exfil Detection）

PTYラッピング時にAIエージェントの出力を監視し、外部送信コマンドや機密情報の漏洩を検知してログに記録する。

#### 設定（~/.config/tmai/config.toml）

```toml
[exfil_detection]
enabled = true                          # デフォルト: true
additional_commands = ["custom-upload"] # 追加コマンド（組み込み以外）
```

#### 検知対象コマンド（組み込み）

| カテゴリ | コマンド |
|----------|----------|
| HTTP | `curl`, `wget`, `httpie`, `http` |
| ネットワーク | `nc`, `netcat`, `ncat`, `socat`, `telnet` |
| ファイル転送 | `scp`, `sftp`, `rsync`, `ftp` |
| クラウドCLI | `aws`, `gcloud`, `az`, `gsutil` |
| その他 | `ssh`, `git push`, `npm publish`, `cargo publish` |

#### 検知対象の機密情報パターン

- OpenAI API Key (`sk-...`)
- Anthropic API Key (`sk-ant-...`)
- GitHub Token (`ghp_...`, `gho_...`, etc.)
- AWS Access Key (`AKIA...`)
- Google API Key (`AIza...`)
- Slack Token (`xox...`)
- Bearer Token
- 秘密鍵（`-----BEGIN PRIVATE KEY-----`）
- 汎用API Key（`api_key=...` 等）

#### ログ出力

| 状況 | ログレベル | メッセージ |
|------|------------|------------|
| 外部送信コマンド検出 | `info` | `External transmission detected` |
| 機密情報を含む外部送信 | `warn` | `Sensitive data in transmission` |

```
# 例
INFO  External transmission detected command="curl" pid=12345
WARN  Sensitive data in transmission command="curl" sensitive_type="API Key" pid=12345
```

**注意**: ログを確認するには `--debug` フラグを推奨。

## 検出監査ログ（Audit Log）

検出器の判定結果をndjson形式で記録し、検出精度の検証・改善に活用する開発者向け機能。

### 有効化

```bash
cargo run -- --audit           # CLIフラグで有効化
cargo run -- --audit --debug   # debug併用推奨
```

設定ファイルでも有効化可能: `[audit] enabled = true`

### 出力先

`$STATE_DIR/audit/detection.ndjson`（10MB超過で `.ndjson.1` にローテーション）

> `$STATE_DIR` = `$XDG_RUNTIME_DIR/tmai`（優先）or `/tmp/tmai-<UID>`（フォールバック）

### イベント型

| イベント | 説明 |
|---------|------|
| `StateChanged` | エージェントの状態が変化（idle→processing等） |
| `AgentAppeared` | 新しいエージェントを検出 |
| `AgentDisappeared` | エージェントが消失 |
| `SourceDisagreement` | IPC検出とcapture-pane検出の結果が不一致 |
| `UserInputDuringProcessing` | Processing/Idle中にユーザ入力があった（検出漏れの可能性） |
| `AutoApproveJudgment` | Auto-approveのAI判定結果 |

### 判定理由（DetectionReason）

各検出結果に以下が付与される:

| フィールド | 説明 |
|-----------|------|
| `rule` | 検出ルール名（例: `braille_spinner`, `title_idle_indicator`） |
| `confidence` | 確信度: `High`（明示パターン）/ `Medium`（ヒューリスティック）/ `Low`（フォールバック） |
| `matched_text` | マッチしたテキスト（最大200文字） |

### 主な検出ルール（Claude Code）

| rule | confidence | 検出内容 |
|------|-----------|---------|
| `user_question_numbered_choices` | High | AskUserQuestion（番号選択肢） |
| `proceed_prompt` | High | 1. Yes / 2. No 形式 |
| `yes_no_buttons` | High | Yes/No ボタン形式 |
| `yes_no_text_pattern` | High | `[y/n]` パターン |
| `error_pattern` | High | エラー検出 |
| `tasks_in_progress` | High | Tasks一覧のin-progress |
| `title_idle_indicator` | High | タイトルの ✳ |
| `content_spinner_verb` | Medium | コンテンツ内spinner（✶/✻/✽/✳/* + 動詞 + …） |
| `braille_spinner` | Medium | Brailleスピナー |
| `custom_spinner_verb` | Medium | カスタムspinnerVerbs |
| `fallback_no_indicator` | Low | 判定根拠なし |

### UserInputDuringProcessing イベント

Processing/Idle状態のエージェントにユーザが入力を送信した場合に記録される。検出漏れ（実際はApproval待ちだがProcessingと誤判定）の発見に活用。

| フィールド | 説明 |
|-----------|------|
| `action` | ユーザの操作: `input_text`, `passthrough_key` |
| `input_source` | 入力元: `tui_input_mode`, `tui_passthrough`, `web_api_input` |
| `current_status` | 入力時点の検出状態: `processing` or `idle` |
| `detection_reason` | 入力時点の検出理由（rule/confidence/matched_text） |
| `detection_source` | 検出ソース: `ipc_socket` or `capture_pane` |
| `screen_context` | ペイン内容の末尾20行（事後分析用） |

パススルーモードは5秒デバウンス（ターゲットごと）で過剰ログ防止。

### ログ活用例

```bash
# 直近の状態変化を確認
cat $STATE_DIR/audit/detection.ndjson | jq 'select(.event == "StateChanged")'

# 低確信度の検出を抽出（改善候補）
cat $STATE_DIR/audit/detection.ndjson | jq 'select(.reason.confidence == "Low")'

# 特定ペインの履歴
cat $STATE_DIR/audit/detection.ndjson | jq 'select(.pane_id == "5")'

# 検出漏れの可能性を確認（Processing中にユーザ入力）
cat $STATE_DIR/audit/detection.ndjson | jq 'select(.event == "UserInputDuringProcessing")'
```

## Auto-approve（自動承認）

4つの動作モード（Off / Rules / AI / Hybrid）で承認待ちプロンプトの安全性を判定し、低リスクな操作を自動承認する機能。

### 動作モード

| モード | 説明 | 速度 | `claude` CLI必要 |
|--------|------|------|-----------------|
| **Off** | 自動承認なし（デフォルト） | — | 不要 |
| **Rules** | パターンベースの即時承認 | サブミリ秒 | 不要 |
| **AI** | AIモデルが各プロンプトを判定 | 約2-15秒 | 必要 |
| **Hybrid** | ルール優先、不明時にAIフォールバック | 一般操作は高速 | 必要 |

### アーキテクチャ

```
Agent → AwaitingApproval
  ↓
Mode dispatch:
  Rules  → RuleEngine.judge()（即時）
  AI     → ClaudeHaikuJudge.judge()（API呼び出し）
  Hybrid → Rules → Uncertain時にAIフォールバック
  ↓
  ├─ Approve (Rule) → ApprovedByRule → 承認キー自動送信
  ├─ Approve (AI)   → ApprovedByAi  → 承認キー自動送信
  ├─ Reject          → ManualRequired
  └─ Uncertain       → ManualRequired（Rulesモード）/ AIフォールバック（Hybridモード）
```

### 判定フェーズ（AutoApprovePhase）

`MonitoredAgent.auto_approve_phase` で判定ライフサイクルを追跡:

| フェーズ | 意味 | TUIインジケータ |
|---------|------|---------------|
| `Judging` | AI判定中（待てば自動処理される） | `⟳` Cyan |
| `ApprovedByRule` | ルール承認済み（キー送信済み） | `✓` Green + "Rule-Approved" |
| `ApprovedByAi` | AI承認済み（キー送信済み） | `✓` Green + "AI-Approved" |
| `ManualRequired(reason)` | ユーザー操作が必要 | `⚠` Magenta |

### 組み込みAllowルール（Rules/Hybridモード）

| ルール | 設定 | マッチ対象 |
|--------|------|-----------|
| 読み取り操作 | `allow_read` | Read, cat, head, tail, ls, find, grep, wc |
| テスト実行 | `allow_tests` | cargo test, npm test, pytest, go test 等 |
| フェッチ/検索 | `allow_fetch` | WebFetch, WebSearch, curl GET |
| Git読み取り専用 | `allow_git_readonly` | git status/log/diff/branch/show/blame 等 |
| フォーマット/リント | `allow_format_lint` | cargo fmt/clippy, prettier, eslint 等 |
| カスタム | `allow_patterns` | ユーザー定義正規表現 |

### スキップされるケース
- 本物のAskUserQuestion（カスタム選択肢、multi_select）
- AutoApproveモードのエージェント（`--dangerously-skip-permissions`）
- `allowed_types` フィルターに含まれない承認タイプ
- 仮想エージェント（ペインなし）

### 安全性
- **ルールエンジン**: Allowルールのみ（Denyなし）。マッチしない操作は手動承認またはAIフォールバック
- **AIジャッジ**: Approve（低リスク）/ Reject（破壊的操作）/ Uncertain（手動フォールバック）

## 課題・TODO

### パススルーモードでのカーソル位置表示
- **目的**: 実際のtmuxペインを見ずに（別タブ等から）プレビュー上で正確な操作を可能にする
- **問題点**: tmuxペインとプレビューの幅が異なるため、行の折り返し位置がずれてカーソル位置が一致しない
- **検討案**:
  - プレビューの幅をペインの幅に合わせる
  - 折り返しを無効化して水平スクロール対応
  - ANSIエスケープコードを解釈してより正確に再現

### fキーで別セッションへのフォーカス
- **目的**: fキーで別セッション（タブ）のペインにもフォーカスできるようにする
- **現状**: `select_window`と`select_pane`のみで、同セッション内の移動のみ対応
- **問題点**: `switch-client`を使うとtmaiが動作しているクライアント自体が切り替わってしまう（SSH経由でWindows↔WSL接続時に顕著）
- **検討案**:
  - 複数クライアントがある場合、tmai以外のクライアントを特定して切り替える
  - fキーでtmaiを終了してから該当ペインに移動する
  - 別セッションへの移動は非対応とし、同セッション内のみに限定する

## 既知の不具合

### wezTerm SSH domain環境での新規AIセッション作成
- **現象**: 新規AIセッション作成時、wezTermで新しいタブが開くが2ペイン構成になる
  - 1ペイン目: 空のシェル
  - 2ペイン目: tmux attach（本来のセッション）
- **原因**: wezTermのSSH domain (`default_domain = 'WSL-SSH'`) 環境では、`wezterm cli spawn`の動作が想定と異なる
- **回避策**: 手動で1ペイン目（空シェル）を閉じる
- **該当コード**: `src/tmux/client.rs` の `open_session_in_wezterm_tab()`
