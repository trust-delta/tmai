# tmai

**Tactful Multi Agent Interface** — *Producer* エージェントがマルチプロジェクト開発を回すための外骨格 (exoskeleton)、そして人間が補助・観察するためのコンソール。

会話するのはプロジェクトごとに 1 つのエージェント — Producer — だけ。Producer はあなたの過去の決定を覚えていて、変わったこと (CI、PR、進行中の作業) を追い、実装が会話を圧迫しそうなときは worker を dispatch し、*本当に人間の判断が要る*ものだけをあなたに渡す。tmai はそれを可能にするもの: continuity 層、worker の spawn/steer 面、always-on な substrate、そしてあなたが覗く窓。

[![License](https://img.shields.io/github/license/trust-delta/tmai)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/trust-delta/tmai?display_name=tag)](https://github.com/trust-delta/tmai/releases)
[![crates.io](https://img.shields.io/crates/v/tmai)](https://crates.io/crates/tmai)
[![React](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/build-react.yml?branch=main&label=React)](https://github.com/trust-delta/tmai/actions/workflows/build-react.yml)
[![Ratatui](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/build-ratatui.yml?branch=main&label=Ratatui)](https://github.com/trust-delta/tmai/actions/workflows/build-ratatui.yml)
[![API spec](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/validate-spec.yml?branch=main&label=API%20spec)](https://github.com/trust-delta/tmai/actions/workflows/validate-spec.yml)

> **English version**: [README.md](./README.md)

<p align="center">
  <img src="assets/tmai-demo.gif" alt="tmai demo" width="720">
</p>

> **このリポジトリは tmai の monorepo + release hub です。** UI クライアント (`clients/react/`、`clients/ratatui/`)、ワイヤー契約 (`api-spec/`)、installer、リリースパイプラインはここに、エンジン実装のみが private の [`tmai-core`](https://github.com/trust-delta/tmai-core) にあります。

## tmai は何のためにあるか

複数のコーディングプロジェクトを並行で回す: プロジェクトごとに 1 つの **Producer** — あなたが会話する Claude Code セッション — と、その下に **worker** — リポジトリごとに 1 つの「限定的に動いて報告して止まる」エージェント。Producer は read-mostly: プロジェクトの記憶と現行の決定事項を保持し、変わったことを監視し、機械的なものは自分でやり、実装が会話を圧迫しそうなときは worker を dispatch し、*分解不能な*決定だけをあなたに — 高密度に — route する。あなたの希少なレビュー注意は真のボトルネックにだけ向かい、それ以外には向かわない。

賭けはこう: 強いモデルは「自分の判断を*代行する*」ツールを必要としない — だが*呼び出される* LLM エージェントは依然として episodic (永遠には走れない)、amnesiac (セッション間で学ばない)、自分が spawn した worker の内部に盲目、context が有限。tmai はまさにその構造的なピースを供給する:

- **continuity** — fused baseline (cross-project memory ⊕ プロジェクトの decisions ⊕ in-flight な handoff) をセッション開始時に合成して Producer に手渡す。再入コストが ~0
- **本物の worker** — リポジトリの worktree で Claude Code セッションをちゃんとした brief 付きで spawn、走らせて、戻ってこさせる。inspect / steer もできる
- **always-on な substrate** — episodic なセッションを生き延びる supervisor。午前 3 時に着地したイベントの行き先がある
- **observability** — worker が*実際に*何をしているかへの、人間の out-of-band な窓 — Producer の要約では得られないもの

### tmai が *やらない* こと

- **オーケストレーションを*機能として*持たない。** 何を起動するか、いつ、どう統合するか、どのアーキテクチャを使うか — tmai のコードはそれを決めない。それは Producer の推論、flex できるエージェントの context の中であって、tmai のコードに固化 (calcify) させない。tmai は route する、build はしない。
- **単一プロジェクトのファンアウトではない。** 律速はあなたのレビュー注意であってエージェントの計算量ではない — 5 エージェントが 1 時間で終わっても、5 時間分のレビューがあなたの机に queue されるだけ。本当に並列なのは*プロジェクト横断*であって、1 つのプロジェクトの中ではない。
- **あなたの判断の代替ではない。** tmai はあなたが要る決定を surface し、Producer の確信度が calibrate されていたかを track する — モデルを上書きしないし、「ちらっと見て承認」を本物のレビューだと偽らない。(薄い意図表明 — 「これが契約境界、合わなければ押し戻せ」— は別物で、それは良いもの。)

## tmai があなたに要求すること

tmai は思想を持つ。そしてその思想*こそ*がプロダクトだ。tmai を採用するとは、それが黙って省かせてくれない規律を一緒に引き受けるということ:

- **目的と手段を分ける。** あなたが引き受ける commitment — 気にかける outcome/value — は *decision*。それを今どう追っているか (機構) は *approach* で、安く変えられるまま置かれる。両者は意図的に別の記録だ: 手段を commitment に見せかけることこそが failure mode であって、近道ではない。
- **decision を accept できるのはあなただけ。** Producer は draft し、論じ、その下で手段を run する — だがあなたの代わりに accept はしない。プロジェクトを縛る唯一の act は、構造的に人間の act のまま。「エージェントが決めた」は存在しない。
- **あなたの注意は使い潰さない。** tmai は本当に人間が要る決定だけを surface し、「ちらっと見て承認」を本物のレビューだと偽らない。

なぜ速く行くのでなく、これを*強制*するのか? 希少なのはあなたの判断であって、エージェントの計算量ではないから。間違ったワークフロー — 全部 approve、無限に fan out、エージェントが自分の仕事を自分で祝福する — を簡単にするツールは、その希少なものを、まさに守るべき場所で焼き尽くす。この規律は、人間が commitment を引き受け続け、エージェントが機構を担う状態を保つ最低ライン (floor) だ。

これは worldview であり、それ*こそ*が全部だ — off にできる設定ではない。「見ていない間にエージェントがどれだけやれるか」を最大化したいなら、tmai は意図的に間違ったツールだ。tmai は、あなたが loop に居続ける seam を保つ。その seam *こそ*が価値だからだ: それを外せば、残るものは tmai ではない。install してから friction で気づくより、その前に知っておく方がいい。

## 形

- **あなた** (episodic) — プロジェクトごとに 1 つの Producer と会話する。分解不能なものを決める。
- **Producer** — プロジェクトごとに 1 つ (Claude Code セッション)。baseline を保持、変わったことを triage、機械的なものは自分でやる、worker を dispatch、brief を書く。read-mostly: アーキテクチャは*提案*し決定はしない、route し build はしない。
- **tmai** — Producer が走る **外骨格** (continuity / worker の spawn・steer / always-on substrate) であり、*かつ* あなたが補助・観察する **コンソール** (WebUI、TUI、モバイルリモート)。
- **worker** — リポジトリごとに 1 つ: 限定的・契約に錨を打った・報告して戻る Claude Code セッション。worker は複数リポジトリに跨らない。tmai は worker 群を自動オーケストレーションしない — プロジェクトのリポジトリ横断の調整は Producer の推論であって tmai のコードではない。

「プロジェクト」とは、1 つのリポジトリ、または共通の目的に向けて契約サーフェスを共有する最小のリポジトリ群 (例: エンジン + spec + WebUI)。リポジトリ数がいくつでも、プロジェクトごとに Producer は 1 つ。

## インストール

対応プラットフォームのバンドル tarball は本 repo の [Releases](https://github.com/trust-delta/tmai/releases) に添付されます。用途に合う方法を選んでください — 下記 3 つはすべて同じバンドルを配置します:

### Curl (どの環境でも動く)

```bash
# 最新リリースを $HOME/.local (デフォルト prefix) に:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash

# バージョンと prefix を指定:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh \
  | bash -s -- --version 3.2.0 --prefix /usr/local
```

### Homebrew (macOS + Linux)

```bash
brew tap trust-delta/tmai
brew install tmai
```

### `cargo binstall` (Rust 環境がある場合)

```bash
cargo binstall tmai
```

crates.io の [`tmai`](https://crates.io/crates/tmai) クレート側 `[package.metadata.binstall]` を参照し、プラットフォームに合う tarball を取得します。

### 展開先

```
$PREFIX/bin/tmai
$PREFIX/bin/tmai-ratatui
$PREFIX/share/tmai/webui/       # tmai が binary 相対 fallback で自動配信
$PREFIX/share/tmai/api-spec/    # OpenAPI + CoreEvent JSON Schema リファレンス
```

対応プラットフォーム: Linux x86_64、Linux aarch64、macOS arm64。他のプラットフォームは [`tmai-core`](https://github.com/trust-delta/tmai-core) でのソースビルド (リポジトリ権限が必要)。

## クイックスタート

```bash
# 初回セットアップ: ~/.claude/settings.json に Claude Code hook receiver を登録
tmai init

# エンジン + 運用ダッシュボード TUI を起動 (エンジン健全性、アクティビティ、ログ、UI launcher)
tmai

# プロジェクト (またはリポジトリ群) の Producer セッションを開く。fused baseline を手渡した状態で
tmai producer <unit>

# decision store をブラウズ
tmai decisions
```

`tmai` はバンドルされた WebUI を自動配信します — 表示される URL を開いてください。WebUI 開発 (Vite HMR を `tmai` backend に対して) は [`CONTRIBUTING.ja.md`](CONTRIBUTING.ja.md) を参照してください。

## 現在 ship しているもの

- **エンジン** (`tmai-core`、private) — HTTP/SSE API サーバー (`/api/*`、`/api/events`)。MCP ホスト (Producer が worker を dispatch/steer する / エージェントを inspect する / PR・CI を駆動する / プロンプトに作用する — stdio JSON-RPC 2.0 経由のツール群)。hook ベースのエージェント検出 (`attention: started | halted | completed | null`、Claude Code の hook 駆動 — ポーリングなし)。そして **workbench**: `tmai producer <unit>` が fused baseline を合成して Producer セッションに手渡す、`tmai decisions` が decision store をブラウズ、`tmai handoff` が in-flight な作業状態の store。
- **React WebUI** (`clients/react/`) — 現状の operator サーフェス: エージェント一覧、xterm 経由のライブプレビュー、prompt/approve、マルチペイン表示モード、`AskUserQuestion` 対応のモバイルリモート。tmai 独自のサーフェス — *複数プロジェクトで、プロジェクト状態を確認しつつ Producer と対話する* — へ graduate するパス上。operator ダッシュボードではなく、Producer が見ているものへの窓。
- **Ratatui TUI** (`clients/ratatui/`) — そして `tmai` のデフォルトモードはダッシュボード TUI: エンジン健全性、アクティビティ、検出状態、UI registry、ログ、UI クライアントの起動。health viewer + launcher であってエージェント対話のサーフェスではない。
- **ワイヤー契約** (`api-spec/`) — OpenAPI 3.1 + CoreEvent JSON Schema + MCP ツールスナップショット。UI は 3 つの標準サーフェスで統合する: HTTP REST (`/api/*`)、SSE イベントストリーム (`/api/events`)、MCP (`tmai mcp`)。spec はエンジンとは独立した SemVer に従う。UI は未知のイベント variant と optional フィールドを許容する必要がある。
- **Git 面** — `gh` 経由の PR / CI / issue 連携、worktree CRUD。
- **インストール & リリース** — `install.sh`、Homebrew tap、`cargo binstall` メタデータ stub、target 毎のバンドル tarball を組み立てるリリースワークフロー。

## 方向

Producer モデルは core-first で構築中:

- **bottom-up feedback** — タスクは完了したが「これは動くが、別のアプローチの方がいい」と気づいた worker がそれを書き残す。Producer は溜まったノートを定期的に synthesize し、tradeoff 込みの提案をあなたに上げる。*方法論*が固化 (calcify) しないようにするチャンネル — 「詰まった、決めて」(これは Producer がリアルタイムで検知する) とは別物。
- **idle-gated synthesis** — あなたが居ない間、always-on な supervisor が Producer を retrospective モードで起こす。戻ってきたとき、あなたが要る決定だけの高密度な digest を受け取る。preemptible — あなたのセッションが priority を取る。
- 上記の **WebUI graduation**。

旧「オーケストレーションを*機能として*持つ」モデル — auto-approve、cron スケジュールでの起動、CI イベントの自動ハンドリング — は `v3.0.0`–`v3.x` で撤去された: 間違ったワークフローを簡単にするツールはツールが無いより悪い。これらすべての設計記録は `tmai-core` (private) にある。

## 構成

| Repo | 可視性 | 役割 |
|------|--------|------|
| `trust-delta/tmai` (本リポジトリ) | public | release hub + monorepo。React WebUI (`clients/react/`)、ratatui TUI (`clients/ratatui/`)、ワイヤー契約 (`api-spec/`)、installer、ドキュメントを保持。bundle tarball を配布。 |
| [`tmai-core`](https://github.com/trust-delta/tmai-core) | private | コアエンジン — HTTP/SSE API サーバー、MCP ホスト (Producer の dispatch/steer ツール)、hook ベースのエージェント検出、workbench。`core-v*` Release で target 毎のバイナリを供給し、生成物の spec / types は bot PR 経由で本リポジトリへ流入。 |
| `tmai-api-spec` / `tmai-react` / `tmai-ratatui` | archive | 履歴保全のみ。内容は 2026-04-23 に本リポジトリへ統合済。 |

## コントリビューション

UI / 契約 / ドキュメント / パッケージング変更は本リポジトリに直接 issue / PR を提出してください:

- **React WebUI** → `clients/react/`
- **Ratatui クライアント** → `clients/ratatui/`
- **ワイヤー契約** (REST エンドポイント、CoreEvent variants、error taxonomy) → `api-spec/` (生成物 — 編集は [`tmai-core`](https://github.com/trust-delta/tmai-core) 側から bot PR 経由で反映)
- **Installer / release workflow / docs** → ルート

エンジン関連の変更 (MCP ホスト、HTTP/SSE 実装、エージェント検出、workbench、Producer の dispatch ツール) は private の [`tmai-core`](https://github.com/trust-delta/tmai-core) で行います。エンジン側で変更が必要な場合は本リポジトリに issue を立てていただければ triage します。

旧 sub-repo (`tmai-api-spec`、`tmai-react`、`tmai-ratatui`) は 2026-04-23 に archive 済です — そちらへの issue / PR 提出は控えてください。

ローカル開発手順 (Vite HMR + `tmai` backend)、bot PR recovery フロー、PR 規約は [`CONTRIBUTING.ja.md`](CONTRIBUTING.ja.md) を参照してください。セキュリティ報告は [`SECURITY.ja.md`](SECURITY.ja.md) (GitHub Private Vulnerability Reporting)。

## スクリーンショット

<p align="center">
  <img src="assets/usage-view.png" alt="Usage tracking" width="720">
</p>

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="モバイルリモート — エージェント一覧" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="モバイルリモート — AskUserQuestion" width="280">
</p>

## 履歴

tmai は当初単一の monorepo として始まり (2026-04-18 まで)、一時的に 4 つのリポジトリ ([`tmai-core`](https://github.com/trust-delta/tmai-core) + `tmai-api-spec` / `tmai-react` / `tmai-ratatui`) に分割されました。2026-04-21 に UI 層と契約を本リポジトリの `clients/` / `api-spec/` 配下へ再統合、旧 3 sub-repo は 2026-04-23 に archive されました。split 直前の最終コミットは [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d)、再統合は [`v2.0.0`](https://github.com/trust-delta/tmai/releases/tag/v2.0.0) で配布されました。

`v3.0.0` (2026-05) で tmai は反転しました: 「多数のエージェントを覆い、それぞれに足りないものを供給する賢い層」で*ある*ことをやめ、Producer エージェントが使う外骨格になりました — オーケストレーションの*locus* が tmai のコードから Producer の推論へ移った。`v3.0.0`–`v3.x` で旧前提のサブシステム (auto-approve、cron スケジューリング、CI イベントの自動ハンドリング) を撤去し、Producer workbench が新しい中心として landed しました。

crates.io の `tmai` クレートは thin installer-metadata stub として運用中です: `1.7.0` が最後の "実体" クレート (yank せず)、`1.7.1` は deprecation marker、`2.0.0` 以降は `cargo binstall` 用メタデータ + stub バイナリを同梱 (これは `cargo install tmai` で install された場合、実 installer への pointer を表示するだけです)。上記 install path のどれかを使用してください。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。
