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
