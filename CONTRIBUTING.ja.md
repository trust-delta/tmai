# tmai へのコントリビューション

コントリビューションに興味を持っていただきありがとうございます。本リポジトリは **tmai の monorepo + release hub** であり、UI、ワイヤー契約、installer、リリースパイプラインすべてここにあります。これらに対する issue / PR は本リポジトリに直接提出してください。エンジン関連の作業のみが private の [`tmai-core`](https://github.com/trust-delta/tmai-core) で行われます。

> **English version**: [CONTRIBUTING.md](./CONTRIBUTING.md)

## コントリビュート先

| 変更領域 | 場所 |
|----------|------|
| React WebUI | `clients/react/` (本リポジトリ) |
| Ratatui TUI クライアント | `clients/ratatui/` (本リポジトリ) |
| ワイヤー契約 — REST エンドポイント / CoreEvent variants / error taxonomy | `api-spec/` (本リポジトリ、生成物 — 編集は [`tmai-core`](https://github.com/trust-delta/tmai-core) 側から bot PR 経由で反映、手編集は CI が reject) |
| Installer / release workflow / bundle version pin | `install.sh` / `.github/workflows/` / `versions.toml` (本リポジトリ) |
| ドキュメント / ランディング / スクリーンショット | `README.md` / `README.ja.md` / `CHANGELOG.md` / `assets/` (本リポジトリ) |
| サーバーロジック / オーケストレーション / MCP / HTTP / SSE 実装 | private の [`tmai-core`](https://github.com/trust-delta/tmai-core) (collaborator 権限必要) |

旧 sub-repo (`tmai-api-spec`、`tmai-react`、`tmai-ratatui`) は 2026-04-23 に archive 済です — そちらへの issue / PR 提出は控えてください。

## この hub repo が受け付ける変更

- `clients/react/` — React WebUI のソースとテスト
- `clients/ratatui/` — ratatui クライアントのソースとテスト
- `api-spec/` — 生成済 OpenAPI + JSON Schema + MCP snapshot (手編集は CI が reject、ジェネレーターは `tmai-core` 側)
- `.github/workflows/` — release / validation / pages workflow
- `install.sh` — curl-pipeable installer
- `versions.toml` — `release.yml` が読む bundle バージョン pin
- `README.md` / `README.ja.md` / `CHANGELOG.md` / `LICENSE` / `assets/` — ランディング / ドキュメント / メディア

## Bot 管理の生成ファイル

以下のパスは `tmai-core` 同期 bot が書き込む専用領域です。**手編集は禁止**です：

| パス | 内容 |
|------|------|
| `clients/react/src/types/generated/` | `tmai-core` の Rust ソースから生成した TypeScript 型 |
| `clients/ratatui/src/types/generated/` | `tmai-core` からミラーされた Rust 型 |
| `api-spec/` | OpenAPI spec / JSON Schema / MCP snapshot — すべて生成物 |

CI はこれらのパスを人間の著者が変更した PR を reject します。
PR で `Hand edits detected in bot-managed paths` エラーが出た場合は、
該当ファイルの変更を取り除き、代わりに `tmai-core` 側に issue を立ててください。

### Bot PR リカバリーフロー

同期 bot PR が、生成物でリネーム・削除されたシンボルを参照している消費コードのせいで失敗した場合は、**消費コードだけを最小限修正**してください。生成ファイル自体は絶対に編集しないでください。

**手順**

1. bot ブランチをローカルに checkout する：
   ```sh
   git fetch origin
   git checkout <bot-branch-name>
   ```
2. 壊れたシンボルを参照している消費ファイルだけを開いて参照を更新する。
   `generated/` や `api-spec/` 以下は **一切触らない**。
3. 同じ bot ブランチにコミット・プッシュする：
   ```sh
   git add <変更ファイル>
   git commit -m "fix: update consuming code for <symbol rename>"
   git push origin <bot-branch-name>
   ```
4. CI が自動で再実行されます。全ジョブが green になったらマージしてください。

**実例 — PR #520 (`TaskMetaSnapshot` リネーム)**

`tmai-core` が `TaskMetaEntry` → `TaskMetaSnapshot` にリネームしました。
sync bot PR は生成ファイルを正しく更新しましたが、`src/types/index.ts` が
旧名のまま再エクスポートしていたため TypeScript ビルドが壊れました。

コミット `0a1443f` で適用した修正：
```diff
// clients/react/src/types/index.ts
-export type { TaskMetaEntry } from "./generated/TaskMetaSnapshot";
+export type { TaskMetaSnapshot } from "./generated/TaskMetaSnapshot";
```

変更したのは `src/types/index.ts`（消費コード）のみで、生成ファイルには一切手を加えていません。

### Phase 1 移行中の注意

スナップショット契約移行の Phase 1 期間中は、React クライアントは
**従来の `diff` スタイル CoreEvent** と **新しい `EntityUpdateEnvelope` ラッパー**
の両方を受け取れるようにしておく必要があります。
Phase 3 でレガシーパスを廃止する予定です。それまでは SSE イベントハンドラーで両方の分岐を維持してください。

## Issue

上記リストの領域は本リポジトリに issue を提出してください。エンジン側のバグでも、まず本リポジトリに issue を立てていただければ再現・triage し、必要に応じてエンジン側へ引き継ぎます。

## 言語

Issues / Discussions は英語・日本語どちらでも構いません。
