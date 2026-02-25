---
name: version-up
description: |
  バージョンアップ・リリースを一気通貫で実行するスキル。
  トリガー: 「/version-up」「バージョンを上げて」「リリースして」
  Phase1（PR作成）→ CI・CodeRabbitレビュー監視 → 指摘修正 → Phase2（マージ・タグ）まで自動化。
---

# Version Up Skill

バージョンアップからリリースまでを一気通貫で実行する。
ファイル編集が必要なためメインエージェントで実行すること（`context` なし）。

## 前提

- リポジトリ: `trust-delta/tmai`
- ブランチ戦略: `release/vX.X.X` → PR → `main` (squash merge) → タグ
- CHANGELOGフォーマット: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- SemVer準拠

## Phase 1: PR作成

### 1-1. 現状把握

1. `Cargo.toml` と `crates/tmai-core/Cargo.toml` から現在バージョンを読み取る（両方同じであることを確認）
2. 最新タグを取得:
   ```bash
   git describe --tags --abbrev=0
   ```
3. 前回タグからの変更一覧を取得:
   ```bash
   git log --oneline {prev_tag}..HEAD
   ```

### 1-2. バージョン番号決定

`AskUserQuestion` でバージョン番号を確認:

```
questions: [
  {
    header: "Version"
    question: "次のバージョン番号はどれにしますか？（現在: {current_version}）"
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
2. カテゴリ分類: Added / Changed / Fixed / Improved / Security / Removed
3. `AskUserQuestion` でドラフトを確認（エントリ内容を description に表示）:

```
questions: [
  {
    header: "CHANGELOG"
    question: "CHANGELOGエントリを確認してください。修正が必要な場合は「その他」を選択してください。"
    multiSelect: false
    options: [
      { label: "このままでOK", description: "自動生成されたエントリをそのまま使用" },
      { label: "簡略化して", description: "もっとシンプルにまとめる" }
    ]
  }
]
```

### 1-4. ファイル更新

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

### 1-5. ブランチ・コミット・PR作成

1. ブランチ作成:
   ```bash
   git checkout -b release/v{version}
   ```
2. 変更をステージ・コミット:
   ```bash
   git add Cargo.toml crates/tmai-core/Cargo.toml Cargo.lock CHANGELOG.md
   # ドキュメント更新があれば追加
   git commit -m "chore: bump version to v{version}"
   ```
3. プッシュ:
   ```bash
   git push -u origin release/v{version}
   ```
4. PR作成:
   ```bash
   gh pr create --base main --title "chore: bump version to v{version}" --body "$(cat <<'EOF'
   ## Summary
   - Bump version from {old_version} to {version}
   - Update CHANGELOG.md

   ## Changes
   {changelog_entry}

   ## Checklist
   - [x] Version bumped in Cargo.toml and crates/tmai-core/Cargo.toml
   - [x] CHANGELOG.md updated
   - [x] Cargo.lock updated
   EOF
   )"
   ```
5. PR番号とURLをユーザに報告

## Phase 2: CI・CodeRabbit監視ループ

### 2-1. CI監視

1. `gh pr checks` をバックグラウンドで監視:
   ```bash
   gh pr checks {pr_number} --watch
   ```
2. CIが失敗した場合:
   - エラーログを確認: `gh pr checks {pr_number}`
   - 修正を実施
   - コミット・プッシュして監視ループの先頭に戻る

### 2-2. CodeRabbitレビュー確認

1. CI完了後、PRコメントを取得:
   ```bash
   gh api repos/trust-delta/tmai/pulls/{pr_number}/comments
   ```
2. PRレビューコメントも取得:
   ```bash
   gh api repos/trust-delta/tmai/pulls/{pr_number}/reviews
   ```
3. CodeRabbitの指摘を分析:
   - `✅ Addressed` マーク付きのコメントは対応済みとしてスキップ
   - 未対応の指摘があれば内容を分析し修正を実施
   - 修正後はコミット・プッシュして監視ループの先頭に戻る
4. CI全パス & 未対応の指摘なし → Phase 3 へ

### 2-3. 監視ループの構造

```
loop {
  1. gh pr checks --watch (バックグラウンド)
  2. CI完了待ち
  3. CI失敗 → 修正 → continue
  4. CodeRabbitコメント確認
  5. 未対応指摘あり → 修正 → continue
  6. 全パス → break → Phase 3
}
```

## Phase 3: マージ・タグ

### 3-1. マージ確認

`AskUserQuestion` でマージに進むか確認:

```
questions: [
  {
    header: "Merge"
    question: "CI・レビューがすべてパスしました。マージ＆タグ打ちに進みますか？"
    multiSelect: false
    options: [
      { label: "マージ＆タグ打ち", description: "squashマージ → タグ打ちまで実行" },
      { label: "まだ待つ", description: "手動で確認してから進める" }
    ]
  }
]
```

「まだ待つ」が選択された場合は、PR URLを表示して終了。

### 3-2. マージ・タグ実行

1. squashマージ:
   ```bash
   gh pr merge {pr_number} --squash --delete-branch
   ```
2. main を同期（squash merge後はローカルとリモートがdivergenceするため `reset --hard` を使用）:
   ```bash
   git checkout main && git fetch origin main && git reset --hard origin/main
   ```
3. タグ打ち:
   ```bash
   git tag v{version} && git push origin v{version}
   ```

## Phase 4: 完了報告

crates.io への公開はタグpush時に CI（`.github/workflows/publish.yml`）が自動実行する。
スキルでは手動publishは行わない。

以下を報告:
- リリースバージョン: `v{version}`
- PR URL
- タグ URL: `https://github.com/trust-delta/tmai/releases/tag/v{version}`
- crates.io公開: CIが自動実行（`Publish to crates.io` ワークフロー）
- CHANGELOGエントリの概要

## エラーハンドリング

- `cargo build` 失敗 → エラー内容を表示し修正を提案
- `git push` 失敗 → リモートの状態を確認し対処
- `gh pr create` 失敗 → 既存PRの有無を確認
- `gh pr merge` 失敗 → マージ可能な状態か確認（CI, review, conflict）
- `Publish to crates.io` CI失敗 → `gh run view` でログを確認。already exists 以外のエラーなら対処
- Phase 2 で3回以上ループした場合 → ユーザに状況を報告し続行するか確認

## 使用例

```
ユーザー: /version-up
→ 現在: v0.5.0, 前回タグ: v0.5.0
→ 変更一覧を表示
→ バージョン選択: 0.6.0 (minor)
→ CHANGELOG自動生成・確認
→ Cargo.toml更新（version + tmai-core依存version）、ブランチ作成、PR作成
→ CI監視 → CodeRabbit確認 → 修正（必要なら）
→ マージ確認 → squashマージ → v0.6.0タグ
→ crates.io公開はCIが自動実行
→ 完了報告
```
