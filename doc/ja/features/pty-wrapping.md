# PTYラッピング

PTYプロキシによる高精度な状態検出。

## 概要

PTYラッピングは、AIエージェントをPTYプロキシ経由で起動し、入出力を直接監視することで、従来のtmux capture-paneより正確な状態検知を実現します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                        tmai (親)                             │
│  ┌─────────────┐   ┌────────────┐   ┌───────────────────┐  │
│  │   Poller    │◄──│ PtyMonitor │◄──│ /tmp/tmai/*.state │  │
│  └─────────────┘   └────────────┘   └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                              ▲
                                              │ 状態書き込み
┌─────────────────────────────────────────────┴───────────────┐
│                    tmai wrap claude                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  User ←→ PTY Proxy ←→ claude                           │ │
│  │              │                                          │ │
│  │         StateAnalyzer → /tmp/tmai/{pane_id}.state      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 使用方法

```bash
# Claude CodeをPTYラッピングで起動
tmai wrap claude

# 引数付き
tmai wrap "claude --dangerously-skip-permissions"

# 他のエージェント
tmai wrap codex
tmai wrap gemini
```

## 比較

| 方式 | 検出方法 | タイミング | 機能 |
|------|----------|------------|------|
| capture-pane | 画面テキスト解析 | ポーリング間隔 | 基本 |
| PTYラッピング | I/O直接監視 | リアルタイム | フル |

### 従来方式（capture-pane）

```
tmux capture-pane → 画面テキスト解析 → 状態推定

問題: タイミングによっては状態変化を見逃す可能性
```

### PTYラッピング

```
I/O直接監視 → リアルタイム状態検出

メリット: 状態遷移を確実に捕捉、より正確
```

## 状態検出ロジック

| 状態 | 検出方法 |
|------|----------|
| Processing | 出力が流れている（最後の出力から200ms以内） |
| Idle | 出力停止、プロンプト検出なし |
| Approval | Yes/Noパターン検出 + 出力停止後500ms経過 |

## 状態ファイル形式

状態ファイルは `/tmp/tmai/{pane_id}.state` に書き込まれます：

```json
{
  "status": "awaiting_approval",
  "approval_type": "user_question",
  "details": "どのアプローチを好みますか？",
  "choices": ["async/await", "callbacks", "promises"],
  "multi_select": false,
  "cursor_position": 1,
  "last_output": 1706745600000,
  "last_input": 1706745590000,
  "pid": 12345,
  "pane_id": "0"
}
```

### フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| status | string | `processing`, `idle`, `awaiting_approval` |
| approval_type | string? | 承認タイプ（status=awaiting_approval時のみ） |
| details | string? | 承認リクエストの詳細説明 |
| choices | string[] | AskUserQuestionの選択肢 |
| multi_select | bool | 複数選択可能か |
| cursor_position | number | 現在のカーソル位置（1-indexed） |
| last_output | number | 最後の出力タイムスタンプ（Unix ms） |
| last_input | number | 最後の入力タイムスタンプ（Unix ms） |
| pid | number | ラップされたプロセスのPID |
| pane_id | string? | tmuxペインID |

## メリット

1. **リアルタイム検出**: 状態変化を即座に検出
2. **正確なAskUserQuestion**: 選択肢を確実に解析
3. **外部送信検知**: Exfil検出が有効
4. **ポーリング遅延なし**: 状態遷移への即時対応

## フォールバック動作

- 状態ファイルが存在しない場合: capture-paneにフォールバック
- PTYエラー時: 即座に従来方式にフォールバック
- 既存セッション: capture-paneで継続監視

## 検出ソース表示

tmaiはステータスバーに検出方式を表示します：

- `PTY` - PTYラッピング（高精度）
- `CAP` - capture-pane（従来方式）

## 次のステップ

- [外部送信検知](./exfil-detection.md) - PTYモードでのセキュリティ監視
- [AskUserQuestion対応](./ask-user-question.md) - 選択肢の選択
