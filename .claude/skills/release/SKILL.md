---
name: version-up
description: |
  バージョンアップ・リリースを一気通貫で実行するスキル。
  トリガー: 「/version-up」「バージョンを上げて」「リリースして」
  現状把握 → バージョン決定 → CHANGELOG → main直接コミット → タグ → 完了報告。
---

# Version Up Skill

バージョンアップからリリースまでを一気通貫で実行する。
ファイル編集が必要なためメインエージェントで実行すること（`context` なし）。

## 前提

- リポジトリ: `trust-delta/tmai`
- ブランチ戦略: 作業ブランチ（`fix/xxx`, `feat/xxx`）で開発 → PR → `main` (squash merge) → タグ
- **バージョンバンプは main に直接コミット**（PRは作らない。CIはタグpush時のpublishワークフローで担保）
- CHANGELOGフォーマット: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- SemVer準拠

## Phase 1: 現状把握・バージョン決定

### 1-1. 現状把握

1. main ブランチに切り替え、最新に同期:
   ```bash
   git checkout main && git fetch origin main && git reset --hard origin/main
   ```
2. `Cargo.toml` と `crates/tmai-core/Cargo.toml` から現在バージョンを読み取る（両方同じであることを確認）
3. 最新タグを取得:
   ```bash
   git describe --tags --abbrev=0
   ```
4. 前回タグからの変更一覧を取得:
   ```bash
   git log --oneline {prev_tag}..HEAD
   ```
5. 変更がなければ「リリースする変更がありません」と報告して終了

### 1-2. バージョン番号決定

`AskUserQuestion` でバージョン番号を確認:

```
questions: [
  {
    header: "Version"
    question: "次のバージョン番号はどれにしますか？（現在: {current_version}）\n\n変更内容:\n{commit_list}"
    multiSelect: false
    options: [
      { label: "{patch_version}", description: "パッチ: バグ修正・小改善" },
      { label: "{minor_version}", description: "マイナー: 新機能追加" },
      { label: "{major_version}", description: "メジャー: 破壊的変更" }
    ]
  }
]
```

### 1-3. CHANGELOG エントリ作成

1. `git log --oneline {prev_tag}..HEAD` の内容から CHANGELOG エントリのドラフトを自動生成
2. カテゴリ分類: Added / Changed / Fixed / Improved / Security / Removed / Dependencies
3. `AskUserQuestion` でドラフトを確認:

```
questions: [
  {
    header: "CHANGELOG"
    question: "CHANGELOGエントリを確認してください。\n\n{draft_entry}\n\n修正が必要な場合は「その他」を選択してください。"
    multiSelect: false
    options: [
      { label: "このままでOK", description: "自動生成されたエントリをそのまま使用" },
      { label: "簡略化して", description: "もっとシンプルにまとめる" }
    ]
  }
]
```

## Phase 2: ファイル更新・コミット

### 2-1. ファイル更新

1. `Cargo.toml` と `crates/tmai-core/Cargo.toml` の `version` フィールドを両方更新
2. `Cargo.toml` の `tmai-core` 依存の version 指定も新バージョンに更新:
   ```toml
   tmai-core = { version = "{version}", path = "crates/tmai-core" }
   ```
3. `CHANGELOG.md` の先頭（`## [前バージョン]` の直前）にエントリを追加
4. ドキュメント確認:
   - `README.md`、`README.ja.md` にバージョン固有の記述があれば更新
   - `doc/` 配下に更新が必要なファイルがあれば更新
5. `cargo build` で `Cargo.lock` を更新:
   ```bash
   cargo build 2>&1 | tail -5
   ```

### 2-2. main に直接コミット

1. 変更をステージ・コミット:
   ```bash
   git add Cargo.toml crates/tmai-core/Cargo.toml Cargo.lock CHANGELOG.md
   # ドキュメント更新があれば追加
   git commit -m "chore: bump version to v{version}"
   ```
2. push:
   ```bash
   git push origin main
   ```

## Phase 3: タグ打ち

1. タグ作成・push:
   ```bash
   git tag v{version} && git push origin v{version}
   ```

## Phase 4: 完了報告

crates.io への公開はタグpush時に CI（`.github/workflows/publish.yml`）が自動実行する。
スキルでは手動publishは行わない。

以下を報告:
- リリースバージョン: `v{version}`
- タグ URL: `https://github.com/trust-delta/tmai/releases/tag/v{version}`
- crates.io公開: CIが自動実行（`Publish to crates.io` ワークフロー）
- CHANGELOGエントリの概要

## エラーハンドリング

- `cargo build` 失敗 → エラー内容を表示し修正を提案
- `git push` 失敗 → リモートの状態を確認し対処
- `Publish to crates.io` CI失敗 → `gh run view` でログを確認。already exists 以外のエラーなら対処

## 使用例

```
ユーザー: /version-up
→ main に切替・同期
→ 現在: v0.10.3, 前回タグ: v0.10.3
→ 変更一覧を表示
→ バージョン選択: 0.11.0 (minor)
→ CHANGELOG自動生成・確認
→ ファイル更新 → main に直接コミット・push
→ v0.11.0 タグ作成・push
→ crates.io公開はCIが自動実行
→ 完了報告
```
