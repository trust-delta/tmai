# Fresh Session Review

エージェント完了時に、コンテキストフリーなコードレビューを自動起動する機能です。

## なぜ必要か

AIエージェントはセッション中にコンテキストバイアスが蓄積します。自分が書いたコードのミスには気づきにくいものです。Fresh Session Reviewは**事前コンテキストゼロの別エージェント**でgit diffをレビューし、バイアスのない視点を提供します。

CLAUDE.mdに「作業後にレビューすること」と書いても、コンテキストが長くなると無視されたり、エージェントが不要と判断してスキップすることがあります。この機能は**hookイベント駆動**のため、エージェントの意思に依存せず確実に実行されます。

## 仕組み

1. エージェント完了 → Hook `Stop`イベント発火 → `CoreEvent::AgentStopped`
2. ReviewServiceが `git diff base_branch...HEAD` を収集
3. 構造化レビュープロンプトを生成し、一時ファイルに書き出し
4. 新しいtmuxウィンドウでレビューエージェント（Claude Code / Codex / Gemini）を起動
5. レビュー結果を `~/.local/share/tmai/reviews/{ブランチ名}.md` に保存
6. （オプション）レビューファイルパスを元セッションに送信し、自動修正を促す

## 設定

```toml
[review]
enabled = true
agent = "claude_code"       # claude_code / codex / gemini
auto_launch = true          # エージェント完了時に自動レビュー
auto_feedback = true        # レビュー結果を元セッションに送信
base_branch = "main"        # git diffのベースブランチ
custom_instructions = ""    # 追加のレビュー指示
```

### オプション

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `enabled` | `false` | レビュー機能を有効化 |
| `agent` | `claude_code` | レビューエージェント: `claude_code`, `codex`, `gemini` |
| `auto_launch` | `false` | エージェント停止時に自動レビュー |
| `auto_feedback` | `true` | レビュー結果を元セッションに送信 |
| `base_branch` | `main` | diff比較のベースブランチ |
| `custom_instructions` | `""` | レビュープロンプトに追加する指示 |

## 手動トリガー

TUIで `R`（Shift+R）を押すと、選択中のエージェントに対してレビューを起動します。`auto_launch` の設定に関係なく動作します。

## 自動フィードバック

`auto_feedback = true` の場合、レビュー完了後にレビューファイルパスが元セッションに自動送信されます:

```
Read the code review at ~/.local/share/tmai/reviews/feat-my-feature.md and fix Critical/Warning issues
```

元エージェントがレビューファイルを読んで修正を適用する、自己改善ループが形成されます。

## レビュー出力

レビュー結果は `~/.local/share/tmai/reviews/{ブランチ名}.md` に構造化された形式で保存されます:

- **重大度レベル**: Critical / Warning / Info
- **ファイル・行番号の参照**
- **推奨変更のまとめ**

## セキュリティ

- すべてのファイルパス・tmuxターゲットはシェルエスケープ（シングルクォート）
- ブランチ名は英数字・ハイフン・アンダースコア・ドットのみにサニタイズ
- 大きなdiffは約100KBでUTF-8安全な境界で切断
- プロンプトファイルはタイムスタンプ+PIDで衝突を防止
