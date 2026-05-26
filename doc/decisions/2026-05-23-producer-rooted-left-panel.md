---
status: accepted
category: scoped
tier: 2
governs:
  - clients/react/
cross-repo-refs:
  - "tmai-core:doc/decisions/2026-05-16-producer-identity-and-operator-addressing.md"
  - "tmai-core:doc/decisions/2026-05-18-producer-worker-identity-hierarchy.md"
  - "tmai-core:doc/decisions/2026-05-11-producer-only-operator-interface.md"
last-verified: 2026-05-27
contract-surface: false
related:
  - "2026-05-14-react-producer-console-rebuild"
  - "2026-05-20-provisional-pre-producer-dashboard"
  - "2026-05-14-webui-simulated-onboarded-posture"
---

# 左面を Producer 根の階層 addressing surface に再構成する

**Date:** 2026-05-23
**Tier:** 2 (methodology — tier 付与は Producer↔人間 合意で確定)

## Context

`clients/react/` の左サイドバー（`AgentList`）は、2026-05 反転より前の **「フラットな agent レジストリ」モデル**のまま残っている: Producer も worker も同列の `AgentCard` として `ProjectGroup` に並ぶ。console rebuild（[[2026-05-14-react-producer-console-rebuild]] Phase B）はこれを「Operator view (legacy) — 直接 agent/project アクセスの escape hatch」に降格し default collapsed にしたが、**フラット構造そのものは温存**した。

しかし2つの foundational 決定が既にそこを追い越している:

- **`producer-identity-and-operator-addressing` §A**（preserved & strengthened）: operator は **Producer を addressing** する。worker は co-equal な選択対象ではなく **Producer の関心事（status/artifact）**。直接 worker 選択は緊急 override のみ。
- **`producer-worker-identity-hierarchy`（#410, foundational）**: identity は `<unit>.producer.worker[]` の **Producer 根の階層**であって、フラットな派生レジストリではない。

**Lived friction（2026-05-23, operator が画面で観測）:** 左面の実使用は実質 ①「worker が done したのを知って Producer を選ぶ」②「緊急 spawn」の2つだけに縮退していた。①の「worker done を知る」は**右の attention strip（▶ blocked/awaiting・🔀 PR+CI）＋ Producer feed が既に担っている**ため、左の worker 一覧は右と冗長。これは「壊れ」ではなく、フラット registry が §A / #410 に**未追従**であることの症状。

## Decision

左面を **Producer 根の階層 = unit addressing surface** に再構成する（2026-05-23 セッション、operator 承認）:

| 要素 | 決定 |
|---|---|
| **Producer = headline** | first-class・常時可視・「今話す相手」が一目で legible。選択＝Producer を address。§A の UI 化。 |
| **worker = 従属 child** | Producer 配下にぶら下げ、status 寄りの行（status ドット + branch/task + 任意で PR/CI バッジ）。co-equal peer ではなく **Producer の roster**。 |
| **worker 行の click** | **緊急 direct-address を維持**（従属表示のまま）。§A の emergency-operability 制約（緊急時に worker と直接会話する経路を消さない、cf. `feedback_pty_emergency_terminal_access`）を守るため、完全 status-only にはしない。 |
| **legacy 枠** | 「Operator view (legacy)」枠は**退役 → 「unit addressing surface」に格上げ**。§A 準拠の「Producer を address する」が primary 用途であり、bypass ではない。 |
| **spawn** | dispatch は Producer が brief で行う（[[2026-05-17-worker-lifecycle-is-producer-managed]]）ので operator の直接 spawn は純粋に緊急用 → Advanced/緊急に畳む。 |
| **既定可視性** | collapsible 据え置き（中央会話＋右 strip が primary な console-rebuild の構図は壊さない）。 |
| **multi-unit** | unit ごとに「Producer 根のツリー」が1本（現状 tmai 単一、将来は forest）。 |

### 役割分担（重複回避の肝）

- **左 = 「誰」** — addressing roster（Producer + 配下 worker の構造/identity）。
- **右（attention strip）= 「何があなたを要するか」** — attention（blocked/awaiting・PR+CI・cross-unit needs-you）。

worker は左には常に roster として現れ、右には *operator を要する時だけ* 現れる。これが「左 worker 一覧 ⊥ 右 strip」の冗長を解消する分担であり、`2026-05-20-provisional-pre-producer-dashboard` の dumb-strip 原則（右は judgment を持たない attention 面）とも整合する。

## console-rebuild との関係（部分 supersede）

本 DR は [[2026-05-14-react-producer-console-rebuild]] の **「sidebar = legacy escape hatch、フラット registry 温存」stance を部分 supersede** する（Fork-B narrowing と同じ扱い）。再評価の結果、左面は escape hatch ではなく §A/#410 を反映した **addressing surface** であるべき、と判明したため。emergency override 経路（直接 worker 会話・緊急 spawn）は**保持**するので、`feedback_pty_emergency_terminal_access` には反しない。console-rebuild DR 側 update-history に相互リンクを置く。

## 非範囲

- **右 attention strip の役割変更** — 本 DR は左面のみ。右は「何があなたを要するか」のまま。
- **worker を co-equal peer に戻すこと** — §A に反する。worker はあくまで Producer 配下の roster/status。
- **engine / wire 変更** — これは presentation（既存の agent snapshot + `is_producer` / worktree フラグ / `git_common_dir` から導出）。`<unit>.producer.worker[]` の構造は #410 が core 側で持つが、本 DR は現行 wire で導出できる範囲で階層を**表示**する（core 側 wire 拡張が来たら素直に差し替え、cf. simulated-onboarded posture）。
- **pixel-level spec** — 本 DR は意図と形（Producer 根・who/what 分担・緊急保持）を pin するのみ。calcified design は dead-thesis の罠（thin intent）。

## 実装

実装は本 DR を serving する **bounded worker dispatch**（本 DR merge 後）。最小: `AgentList` を Producer-headline + worker-child のツリーに再構成（`findProducerForUnit` で root 判定、残りを配下 roster に）、legacy ラベル退役、worker 行は従属表示で click=緊急 direct-address 維持、spawn を緊急 fold。非Producer-unit / Producer 不在時の degradation は simulated-onboarded posture に従う。

## Ratify

drafting = agent の act（`doc/decisions/README.md` 準拠）。設計方向と worker 扱いの fork は 2026-05-23 の Producer-conversation で operator が承認。本 DR の merge = その ratification。

## Update history

- 2026-05-23 (initial): articulated from the 2026-05-23 left-panel purpose discussion (operator: 現状は「worker done→Producer 選択」「緊急 spawn」の2用途に縮退、根本的な用途から詰めたい). Direction = Producer-rooted hierarchy (option B), worker click = emergency direct-address retained, legacy framing retired → addressing surface. Operator-approved in conversation.
- 2026-05-25 (currency sweep, verified): the serving implementation landed — `ProducerRoster` + Producer-headline/worker-child `AgentList`/`AgentCard`/`ProjectGroup` rework (PR #727, `cf4f65c`) and unit-keyed grouping so a multi-repo unit collapses into ONE Producer-rooted group (PR #729 / #439, `7c548e5`, served by tmai-core #443's `AgentSnapshot.unit`). The within-unit roster structure this DR pins is preserved unchanged. Decision holds; `last-verified` bumped.
