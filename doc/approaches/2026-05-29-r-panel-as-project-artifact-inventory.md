---
status: planned
governs:
  - clients/react/src/components/producer-console/
cross-repo-refs:
  - "tmai-core:doc/decisions/2026-05-26-tmai-states-facts-not-appraisals.md"
  - "tmai-core:doc/decisions/2026-05-20-provisional-pre-producer-dashboard.md"
  - "tmai-core:doc/decisions/2026-05-11-review-attention-budget-principle.md"
  - "tmai-core:doc/decisions/2026-05-15-protect-scarce-human-judgment.md"
  - "tmai-core:doc/decisions/2026-05-16-authority-attaches-to-the-act.md"
serves:
  - 2026-05-14-react-producer-console-rebuild
success-signal: >
  >=1 operator dogfood セッションを通じて R panel が project artifact
  inventory として機能する: Producer 会話と並行に R を開き、accordion
  全 collapse default から 1-click で decisions / approaches / PRs / issues /
  calibration / hand-over / files に reach できる。Δ stream は
  producer-feed cursor 共有で mechanical state-change facts を
  chronological に流し、Producer 確認 trigger button（現 L 上部から
  移設）で `triggerProducerFeed` を発火できる。tmai 側は appraisal せず ──
  severity 配色なし・filter "needs-you" なし・priority sort なし・集約
  pill なし、count は mechanical fact のみ。C `▣ Running approaches` /
  `▤ All approaches` の retire と `AttentionStrip` (Fork A) 退役が atomic
  に landed して redundancy なし。vendor-neutral 限定（Claude 固有
  memory 等は載せない）で codex 切替時も R の何も失われない。operator
  が「R を見れば prj 全部 reach できる」体感を持ち、Producer 会話への
  過依存も Producer 不在化も起きていない。
failure-signal: >
  R が結局 attention-filter / severity 配色 / priority sort を足さないと
  operator が prj 状態を捉えきれず Producer 会話に過依存する ／ 逆に
  R が完備しすぎて Producer 会話が省略され Producer の存在意義が薄れる
  ／ accordion 全 collapse default が friction 高く operator が vertical
  全展開を欲する（density 制御が原則レベルで誤判）／ Δ stream cursor
  共有が Producer pull と衝突して同期破綻 ／ vendor-neutral 限定が
  制約となり「Claude 固有重要情報が R にない」と operator が訴える
  （memory defer 判断が事実誤認だった）／ R landing 後も C `▣` / `▤` が
  dogfood で使われ続け retire 不可（briefing layer / raw inventory
  layer 分業の design が機能しない）。
review-trigger:
  - kind: manual
    description: >
      R panel 実装 PR が landed し >=1 operator dogfood セッションで R
      が実際に使われた後の体感判断。verdict は value-laden（原則整合 /
      操作感 / Producer-R 役割分業）ゆえ act-boundary rule
      ([[2026-05-16-authority-attaches-to-the-act]]) により operator-gated、
      Producer の判定でない。
confidence: low
---

# R panel を project artifact inventory として再定義する

> **Raised 2026-05-29.** [[2026-05-26-tmai-states-facts-not-appraisals]] の `ordering ⊥ appraisal ⊥ suppression` 軸を R panel に純粋適用すると、現 `AttentionStrip` (Fork A: "attention-grade only") の **filter "needs you" 行為そのもの** が appraisal に該当することが見える。tmai = Producer + artifact の前提から、R は **operator が Producer 会話と並行に開ける唯一の場**（L は addressing、C は会話）なので、R が担うべきは **「このプロジェクトの artifact を見ようと思えば全部 reach できる」accessibility surface**。Producer-drafted（means の articulating）; accept は operator の merge act。

## 何を pin するか

### R = vendor-neutral project artifact inventory

vendor 切替で失われる情報（memory, transcripts, hooks state）は **載せない** discriminator ── 「project 情報が vendor 依存」を暗黙化する設計を避ける。

| section | source |
|---|---|
| 🔀 PRs | GH API (open + 直近 merged + CI + branch) |
| 📋 Issues | GH API (open + 直近 closed) |
| ⬡ Decisions | `doc/decisions/*.md` |
| ▣ Approaches | `doc/approaches/*.md` |
| 📊 Calibration | `/units/{unit}/calibration` |
| 📜 Hand-over | `~/.tmai/handoffs/<unit>/` archive + latest |
| 📁 Files | repo root link + 特定 record/PR への deep-link（IDE 競合せず access path のみ） |

### Δ stream + Producer 確認 trigger（R 上部）

- **source** = producer-feed cursor 流用（1 cursor、2 consumers: Producer pull と R display が同 cursor 共有）
- **形式** = `HH:MM <fact>` chronological bulleted plain text
- **集約・severity 配色・priority sort なし**
- operator dismiss で cursor 前進（tmai 自動進行しない）
- 空時は section 自体非表示
- 右に `[→Producer ⚡]` button（現 L 上部の Producer 確認 trigger を移設）

### 表示形式 = accordion + 全 collapse default

- section header 常時可視（category 一覧性）
- 本体は operator 選択で expand、localStorage `ui-prefs.ts` で persist（operator preference であって tmai-side appraisal でない）
- count = mechanical fact のみ（`(3 open)` 等）、severity 配色禁、loudness は text 同等
- per-section ordering = mechanical（number / date / mtime desc, path order）

## tmai は何を絶対しない（negative space）

R 設計の core discriminator は negative space:

1. **filter "needs you"** ── selection 行為が appraisal、operator 判断殺し
2. **severity 配色 / `🔴` 系 saliency** ── 「重要」と subjective 重み付け
3. **priority sort / anomaly sort** ── 「これを先に見ろ」
4. **count badge での urgency 演出** ── count 自体は fact、severity 配色を当てた瞬間 appraisal 化
5. **集約 status pill** (`needs-you/in-progress/quiet`) ── 個別 fact の tmai 重み付け summary
6. **default expand を tmai が select** ── 「これは見るべき」implicit appraisal

## 既存 surface への含意（atomic に同 PR で実施）

- **`AttentionStrip` (Fork A "DUMB SUBSET")** **retire** ── filter "attention-grade only" 自体が appraisal。R が物理スロット継承
- **`CrossUnitStatusSection`** (C 集約 pill) **retire** ── 集約 = appraisal + multi-project 未着手で動かない（将来 L forest 化時に negative space 準拠で再生）
- **C `▣ Running approaches` / `▤ All approaches`** **retire** ── R inventory に集約、redundancy 削除
- **C 列の他 section** (`▶ Where you left off` / `⬡ Settled decisions` / `🔀 Unit PRs` / `◐ Working with this human`) **残す** ── Producer-curated briefing（temperature / 解釈 / 関連性 explanation 付き）。R の plain inventory と質的に違う。**C = briefing layer（Producer 解釈付き）/ R = raw inventory layer（解釈なし）** として両立

## Defer / 本 approach の scope 外

- **L cross-project peripheral 認識**（forest 化 / agent attention inline / dormant unit 表示） ── multi-project が dogfood で未着手 + vendor-agnostic blocked-state signal が未解決 ── friction が出るまで保留（[[feedback-redesign-from-premise-not-retrofit]] の正面適用）
- **[[2026-05-26-tmai-states-facts-not-appraisals]] の `structural-gate visibility` amendment** ── L attention 系の defer に伴い lived-application 待ち。R 設計には不要（R は attention 系をそもそも持たない、defer 対象だから）
- **multi-project dashboard surface**（現 C `▤` 内包の dashboard 意図） ── forest 化と独立 surface 化は将来課題

## Why now

2026-05-29 セッションで [[2026-05-26-tmai-states-facts-not-appraisals]] を R panel に純粋適用する演習を operator と Producer で実施。lived-friction 駆動でなく principle 整合の前向き整理として raise ── 故に approach（means の試行）、決定にしない。dogfood で friction 出れば iterate、出なければ稼働継続。

## 段階

1. 本 approach record merge（operator accept）
2. Worker dispatch: single atomic PR（clients/react のみ） ── R 構築 / Δ stream / Producer 確認 trigger 移設 / accordion + 7 sections / 既存 surface 退役 / tests / posture marker 更新
3. dogfood 観察 → success/failure signal の verdict（operator act, value-laden）

## Update history

- 2026-05-29 (raised): Producer-drafted、原則演習で起票。L attention 系 defer に伴い `structural-gate visibility` amendment は別件で保留。accept は operator merge。
- 2026-05-29 (Amendment 2026-05-29): negative space 6 項を「tmai-driven 禁止 + operator-controlled 対応 affordance の provide 義務」の対構造として再 articulate。silence-is-not-neutral を R-panel 設計に当てて明示。content access の gap は viewer 層 approach に分離 link。Producer-drafted、accept は operator merge。

---

## Amendment 2026-05-29 — operator-controlled affordance provision 義務、silence-is-not-neutral、viewer 層 link

*Producer-drafted; the `accept` is the operator's — the merge of this change. Surfaced from a 2026-05-29 戦略 session where the original articulation の **二つの欠陥** が surface した: (1) negative space 6 項を「禁止域」だけ articulate し operator-controlled 対応 affordance の provide 義務を flatten していた; (2) 「中身が見えない」lived friction が success-signal の「reach」が path-pointing と content-viewing で曖昧だった事を明示した。本 Amendment は (1) を R-panel 設計内部で補正、(2) は viewer 層 approach に分離 link。*

### 何が surface したか

原 approach の negative space 6 項 (filter "needs you" / severity 配色 / priority sort / count badge urgency / 集約 status pill / default expand を tmai が select) は **「tmai-driven 禁止」だけ articulate し、operator-controlled な対応 affordance の provide 義務を articulate していなかった**。これは [`tmai-core:doc/decisions/2026-05-26-tmai-states-facts-not-appraisals.md`] Amendment 2026-05-29 が name した「手段を用意しないことを『tmai 非関与』と読むのは逃げ、operator の希少 judgment コストをその場で奪う」failure mode の R-panel 内 instance。

加えて、content access の gap が surface: R-panel が path / title 提示のみで中身が見えず、判断材料が in-tmai に揃わない。これは別 approach として起票 ([`tmai-core:doc/approaches/2026-05-29-artifact-content-viewer.md`])。

### 修正された articulation — negative space 6 項の対構造

各 6 項について **tmai-driven は禁止 (現状の articulation 維持)、operator-controlled 対応 affordance は provide 義務 (本 Amendment で追加)**:

| dimension | tmai-driven (禁止、原 articulation) | operator-controlled affordance (provide 義務、本 Amendment 追加) |
|---|---|---|
| **filter** | filter "needs you" 等 tmai が "重要" を selection | operator が自身の判断軸で filter 設定 ("今は X tag のみ" 等) |
| **color** | severity 配色 / 🔴 saliency | operator が "私は X 系を赤" 等の color label を assign |
| **sort** | priority sort / anomaly sort | operator が "modified desc" "governs scope 順" 等を選択 |
| **count badge** | urgency 演出 (`5 未読 ⚠`) | operator-configured roll-up view (操作で count を出す) |
| **集約 pill** | tmai-side aggregated `needs-you/in-progress/quiet` | operator が自身の roll-up rule で aggregate |
| **default expand** | tmai が select | operator-set persistent expand (last expand / pin / bookmark) |

Amendment 2026-05-28 (`2026-05-27-approach-lifecycle-planned-and-partial-states.md` の dashboard 設計) 「operator が手動で filter / sort できる必要あり」「per-unit favorite filter / sort settings 保持は nice-to-have」は本 Amendment の此処の articulation の partial 表現だった。本 Amendment はそれを **全 6 項に拡張 + provide 義務として明示**。

### silence-is-not-neutral の R-panel 内含意

事実の surface を削る (silence) のは neutral でなく別 appraisal の暗黙稼働。R-panel 設計の含意:

- 各 artifact entry は **plain inline で常時 surface** (count / mtime / status enum 等 mechanical fact)
- 「modified after last-expand」「last-seen より新しい」等 operator-act anchored event も **plain inline で常時 surface** (色 / badge なしの mechanical text、例: `(modified after last expand)`)
- operator が highlight / filter / sort で扱う affordance を provide
- tmai が silence で隠す choice をしない (suppression は人間のみ、`facts-not-appraisals` 3 項目)

**未読 marker の二段構造例**: plain inline fact 常時 surface (event 発生は隠さない) + operator が highlight on/off / threshold / 表示形式 を設定可。tmai が「未読を default で強調」も「未読を default で隠す」も両方やらない (前者は push、後者は silence-による appraisal)。

### 3 layer 構造として再 articulate

approach の核 discriminator を 3 layer で完全形に:

1. **negative space 6 項禁止** (原 articulation、tmai-driven の form)
2. **operator-controlled 対応 affordance の provide 義務** (本 Amendment 追加)
3. **silence-is-not-neutral / 事実 surface 保持** (本 Amendment 追加)

3 つを一緒に持って初めて push の禁止 と 律速 行使の保護 が両立する。原 approach の 1 layer 表現 (negative space のみ) は naive 削減側に偏った frame だった。

### viewer 層 link

content access の gap は別 approach [`tmai-core:doc/approaches/2026-05-29-artifact-content-viewer.md`] が means として扱う。本 approach の inventory 層と viewer 層は分離 ── R-panel が **artifact inventory + 各 entry の viewer entry-point** を持ち、viewer 機構の内部 design (α/β/γ/δ) は viewer approach 側で discriminate。

R-panel approach の success-signal の「reach」は **本 Amendment 後** 以下 2 component に分解される:

- **path-pointing reach**: R-panel inventory が担う (原 approach scope、Phase 1 で landed)
- **content-viewing reach**: viewer approach が担う (別 approach、本 Amendment で link)

### Phase 2 worker dispatch への反映

原 「段階」section の Phase 2 (single atomic PR) には:

- operator-controlled affordance UI 余地の design 上保持 (Phase 2 では具体実装せず base のみ)
- silence-not-neutral preservation (事実 surface の plain inline、装飾なし)
- viewer approach への entry-point hook (各 section entry の content fetch 経路を Phase 2 で確保し、viewer 実装は viewer approach 側で landing)

を本 Amendment 後の含意として load する。詳細は worker brief で展開。

### Ratify

drafting = agent の act。本 Amendment の articulation (negative space 6 項の対構造化 / silence-is-not-neutral / 二段構造の未読 marker 例 / viewer 層 link) は 2026-05-29 の operator 主導会話で operator が承認。merge = ratification。

原 `status: planned` は keep。本 Amendment の articulation は Phase 2 worker dispatch の brief に load される含意であり、approach 自体の status 変更は要さない。
