# tmai ドキュメント

tmux上でAIエージェント（Claude Code、Codex CLI、Gemini CLI）を監視・操作するためのツール。

**[English version](../README.md)**

## はじめに

- [Getting Started](./getting-started.md) - インストールから最初の監視まで

## ワークフロー

ユースケース別の使い方ガイド。

- [単一エージェント監視](./workflows/single-agent.md) - 基本的な使い方
- [マルチエージェント監視](./workflows/multi-agent.md) - 複数エージェントを同時に監視
- [ワークツリーで並列開発](./workflows/worktree-parallel.md) - Gitワークツリーを使った並列開発
- [スマホから承認](./workflows/remote-approval.md) - Web Remote Controlでリモート操作

## 機能詳細

各機能の詳しい説明。

- [PTYラッピング](./features/pty-wrapping.md) - 高精度な状態検出の仕組み
- [AskUserQuestion対応](./features/ask-user-question.md) - 番号キーで選択肢を直接選択
- [外部送信検知](./features/exfil-detection.md) - セキュリティ機能
- [Web Remote Control](./features/web-remote.md) - スマホからQRコードで操作
- [Agent Teams](./features/agent-teams.md) - Claude Codeチーム監視
- [Auto-Approve](./features/auto-approve.md) - AIによる自動承認

## ガイド

- [tmaiの強み](./guides/strengths.md) - tmaiが得意なこと
- [ベストプラクティス](./guides/best-practices.md) - おすすめの使い方

## リファレンス

- [キーバインド一覧](./reference/keybindings.md) - キーボードショートカット
- [設定ファイル](./reference/config.md) - 設定オプション
- [Web API](./reference/web-api.md) - REST APIドキュメント
