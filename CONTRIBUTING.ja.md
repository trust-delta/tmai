# tmai へのコントリビューション

tmai への貢献に興味を持っていただきありがとうございます！あらゆる形での貢献を歓迎します。

> **English version**: [CONTRIBUTING.md](./CONTRIBUTING.md)

## 開発環境のセットアップ

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo test                    # 全テスト実行
cargo clippy -- -D warnings   # Lint（CI同等、warnings禁止）
cargo fmt --check             # フォーマットチェック（CI同等）
```

## プロジェクト構成

```
crates/
├── tmai-core/    # コアライブラリ（エージェント、API、検出、設定、git、hooks等）
└── tmai-app/     # デスクトップアプリ（開発中）
    └── web/      # Reactフロントエンド（React 19 + TypeScript + Vite + Tailwind v4 + Biome）
src/              # CLIバイナリ（WebUIサーバー + TUI）
web/              # Web Remoteフロントエンド（モバイル承認UI）
doc/              # ドキュメント（英語 + 日本語）
```

## フロントエンド開発

メインWebUIフロントエンドは `crates/tmai-app/web/`:

```bash
cd crates/tmai-app/web
pnpm install
pnpm dev          # Vite開発サーバー
pnpm build        # プロダクションビルド（tsc + vite）
pnpm lint         # Biome lint & フォーマットチェック
pnpm lint:fix     # lint問題を自動修正
```

## 変更の進め方

- `main` からブランチを作成: 機能追加は `feat/xxx`、バグ修正は `fix/xxx`
- コミットは小さく、焦点を絞る
- push前に以下を実行:
  - `cargo test`、`cargo clippy -- -D warnings`、`cargo fmt`
  - `cd crates/tmai-app/web && pnpm lint`（フロントエンド変更時）

## プルリクエスト

- PR は `main` へ squash merge されます
- CI チェックをすべてパスする必要があります（Rust: test, clippy, fmt; Frontend: biome, tsc, build）
- PR タイトルは内容を表す prefix 付き（例: `feat:`, `fix:`, `chore:`）

## コミュニケーション

Issues・Discussions は英語・日本語どちらでも OK です。
