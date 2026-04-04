# tmai ドキュメント

Tactful Multi Agent Interface — AIコーディングエージェント（Claude Code、Codex CLI、Gemini CLI）を統合WebUIで監視・操作するツール。`--tmux`でTUIモードも利用可能。

**[English version](../README.md)**

## はじめに

- [Getting Started](./getting-started.md) - インストールから最初の監視まで

## WebUI機能

デスクトップWebUI機能（デフォルトモード）。

- [WebUI概要](./features/webui-overview.md) - アーキテクチャ、レイアウト、リアルタイム更新
- [ブランチグラフ](./features/branch-graph.md) - レーンベースのインタラクティブGitコミットグラフ
- [GitHub連携](./features/github-integration.md) - PRステータス、CIチェック、Issue追跡
- [ワークツリー管理](./features/worktree-ui.md) - UIからGitワークツリーを作成・削除・管理
- [ターミナルパネル](./features/terminal-panel.md) - xterm.jsとWebSocket I/Oによるフルターミナル
- [エージェント起動](./features/agent-spawn.md) - WebUIから新しいエージェントを起動
- [Markdownビューア](./features/markdown-viewer.md) - プロジェクトドキュメントの閲覧・編集
- [ファイルブラウザ](./features/file-browser.md) - ディレクトリブラウザとファイル表示・編集
- [セキュリティパネル](./features/security-panel.md) - Claude Code設定の監査・リスク検出
- [使用量トラッキング](./features/usage-tracking.md) - Claudeサブスクリプションのトークン使用量監視

## コア機能

WebUIとTUIの両モードで利用可能な機能。

- [Claude Code Hooks連携](./features/hooks.md) - HTTP Hooksによるイベント駆動型状態検出（推奨）
- [MCPサーバー](./features/mcp-server.md) - tmaiをMCPサーバーとして公開、エージェントオーケストレーション
- [PTYラッピング](./features/pty-wrapping.md) - PTYプロキシによる高精度な状態検出
- [Auto-Approve](./features/auto-approve.md) - AIによる自動承認
- [Agent Teams](./features/agent-teams.md) - Claude Codeチーム監視・可視化
- [AskUserQuestion対応](./features/ask-user-question.md) - 番号キーで選択肢を直接選択
- [外部送信検知](./features/exfil-detection.md) - セキュリティ監視
- [モバイルリモートコントロール](./features/web-remote.md) - QRコードでスマホから操作
- [Fresh Session Review](./features/fresh-session-review.md) - エージェント完了時の自動コードレビュー

## ワークフロー

ユースケース別の使い方ガイド。

- [Issue駆動オーケストレーション](./workflows/issue-driven-orchestration.md) - メインエージェントがissueを並列サブエージェントに分配 **(おすすめ)**
- [ワークツリーで並列開発](./workflows/worktree-parallel.md) - Gitワークツリーを使った並列ブランチ開発
- [マルチエージェント監視](./workflows/multi-agent.md) - 複数エージェントを同時に監視
- [単一エージェント監視](./workflows/single-agent.md) - 基本的な使い方
- [スマホから承認](./workflows/remote-approval.md) - スマートフォンからリモート操作

## ガイド

- [tmaiの強み](./guides/strengths.md) - tmaiが得意なこと
- [ベストプラクティス](./guides/best-practices.md) - おすすめの使い方

## リファレンス

- [設定ファイル](./reference/config.md) - 設定オプションとCLIフラグ
- [TUIモード](./features/tui-mode.md) - tmuxユーザー向けratauiターミナルUI
- [キーバインド一覧](./reference/keybindings.md) - TUIキーボードショートカット
- [Web API](./reference/web-api.md) - REST API、SSEイベント、WebSocketエンドポイント
