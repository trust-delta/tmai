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

## 変更の進め方

- `main` からブランチを作成: 機能追加は `feat/xxx`、バグ修正は `fix/xxx`
- コミットは小さく、焦点を絞る
- push前に `cargo test`、`cargo clippy -- -D warnings`、`cargo fmt` を実行

## プルリクエスト

- PR は `main` へ squash merge されます
- CI チェック（test, clippy, fmt）をすべてパスする必要があります
- PR タイトルは内容を表す prefix 付き（例: `feat:`, `fix:`, `chore:`）

## コミュニケーション

Issues・Discussions は英語・日本語どちらでも OK です。
