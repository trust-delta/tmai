# セキュリティポリシー

> **English**: [SECURITY.md](./SECURITY.md)

## 脆弱性の報告

GitHub の **Private Vulnerability Reporting** をご利用ください:

> https://github.com/trust-delta/tmai/security/advisories/new

修正前の意図しない開示を避けるため、public な issue / discussion / pull request では報告**しないでください**。

GitHub のフローが利用できない場合は、[tmai org ページ](https://github.com/trust-delta) に記載のメールアドレスへご連絡ください。

対応:

- **3 営業日以内**に受領を連絡します。
- **7 営業日以内**に triage 結果 (受理 / 追加情報依頼 / scope 外) をお知らせします。
- 開示タイミングはご相談の上で決定し、ご希望がない限り GitHub Security Advisory にて報告者をクレジットします。

## スコープ

本リポジトリ (`trust-delta/tmai`) は public monorepo + release hub です。以下に関する報告はここで受け付けます:

- React WebUI (`clients/react/`)
- Ratatui TUI (`clients/ratatui/`)
- Wire contract (`api-spec/` — `tmai-core` から生成)
- インストーラー (`install.sh`) およびリリースワークフロー (`.github/workflows/`)
- 本リポジトリから公開された binary / bundle tarball

エンジン本体 (`tmai`, `tmai-core`) は別の private リポジトリで開発されています。エンジン側の報告も本リポジトリにお寄せいただいて構いません — 再現・triage の上で両リポジトリ間で開示を調整します。

### スコープ外

- 上流に triage 済でない第三者依存パッケージの脆弱性 — まず上流プロジェクトに報告してください。生じた advisory はこちらで追跡します。
- 既に `tmai` 実行ホストへの shell アクセスを持つ攻撃者を前提とする問題。(`tmai` はローカル AI エージェントを統合する性質上、ローカルユーザーを意図的に信頼しています。)
- 認証状態を伴わないページに対する self-XSS / clickjacking、または本コードベースの欠陥を伴わないソーシャルエンジニアリング系の報告。
- アーカイブ済の旧 sub-repo (`tmai-api-spec`, `tmai-react`, `tmai-ratatui`) に対する報告 — `trust-delta/tmai` に対して提出してください。

## サポート対象バージョン

[Releases ページ](https://github.com/trust-delta/tmai/releases) の **最新リリース** をサポートします。古いリリースには patch を提供しません。アップグレードしてください。

## 本リポジトリで有効化されているセキュリティツール

- **GitHub Secret Scanning** + **Push Protection** — 有効
- **CodeQL** — default setup、push / pull request で実行
- **Dependabot** — npm (`clients/react/`, `api-spec/`)、cargo (`clients/ratatui/`)、GitHub Actions の weekly version update + 既知 advisory の自動 security PR
- **Private Vulnerability Reporting** — 有効
