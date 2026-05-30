---
status: accepted
category: foundational
tier: 1
governs:
  - clients/react/
cross-repo-refs:
  - "tmai-core:issues/340"
  - "tmai-core:issues/341"
  - "tmai-core:doc/decisions/2026-05-13-tmai-is-a-producer-exoskeleton.md"
  - "tmai-core:doc/decisions/2026-05-13-producer-feedback-loop-and-decision-tiers.md"
last-verified: 2026-05-31
contract-surface: false
related:
  - "2026-05-14-react-producer-console-rebuild"
---

# WebUI で simulated-onboarded posture を採る — tmai-core multi-repo / onboarding が landed するまで

**Date:** 2026-05-14
**Tier:** 1 (foundational — UI 側全体の stance に影響、Producer↔人間 合意で確定)

## Context

2026-05-14 の dogfood で、Producer console (PR #672) を tmai プロジェクトに立ち上げようとして 2 つの構造的 gap が表面化した:

1. **Multi-repo unit** — tmai プロジェクトは public (`trust-delta/tmai`) + private (`trust-delta/tmai-core`) の 2 リポ構成。`compose()` は単一 `cwd` の `doc/decisions/` しか読まないので、public 側 Producer は private 側の戦略 DR を一切 見られない。tmai-core 側 issue **#340** で `UnitConfig.also[]` を実装予定 (未着手)。
2. **Onboarding / cold-start** — `compose()` は 5 つの前提 (DR 群が YAML / CLAUDE.md / `[[unit]]` config / handoff dir) が全部 揃っている前提で書かれていて、1 つ欠けると落ちる。`tmai onboard <unit>` skeleton も無い。tmai-core 側 issue **#341** で `compose()` robust 化 + `tmai onboard` を予定 (未着手)。

両方とも **本来 Producer が両リポ越境して扱うべき** だが、その基盤自体が未整備。WebUI 側だけで完結はできない。

しかし dogfood を止めるのは反転 workstream のコストに見合わない。WebUI が「core 側が landed してから対応する」姿勢を取ると、Producer console は **空の `⬡ Settled decisions` と空の `⬢ Cross-unit status` を抱えたまま** main で運用されることになる — それ自体が反証として強い摩擦を生む。

## Decision

WebUI は **`simulated-onboarded` posture** を採る: tmai-core 側 #340 / #341 が landed するまでの間、UI は「不完全な前提でも壊れない」「人間に何が欠けているかを正直に見せる」「コア側が landed したら速やかに WebUI 側 compensation を撤去できる」の 3 原則で動く。

### 3 原則

1. **Graceful degradation** — wire / file 由来のデータが不在 / malformed でも UI は落ちず、該当セクションは empty placeholder + 「何が無いから空なのか」を 1 行で説明する。
2. **Transparency over completeness** — 「Producer console が稼働している」という見かけを保つために何かを fabricate するのは禁止。空は空として表示する。
3. **Retirable compensation** — UI 側で足した「coping」コードは必ず `// TODO(tmai-core#NNN): retire when X lands` コメントを付け、cross-refs に該当 issue を書く。core 側が landed したら git grep で全部出る状態を保つ。

### 具体的な UI posture

| Gap | 現状 (core 未対応) の WebUI 挙動 | core 側 landed 後の retire 動作 |
|---|---|---|
| **Multi-repo unit** (#340) | `⬡ Settled decisions` は **primary repo (= 起動時の cwd) の `doc/decisions/` のみ** から導出。section header に「Showing decisions from `<repo>` only — multi-repo unit not yet supported」の小さい注記。 | `useHandover` が `GET /api/units/{unit}/hand-over` の `repos[]` を素直に使う形に切り替え。注記削除。 |
| **Onboarding missing files** (#341) | `compose()` が落ちる代わりに、現状 WebUI 側で **不在検出を `useHandover` で行う** (`doc/decisions/` が空 / `[[unit]]` 未登録 / handoff dir 不在 などを client で判定)。「未初期化 — `tmai onboard <unit>` を実行してください」banner を出す。 | core 側 `meta.missing_preconditions[]` を見る方式に切替。client-side 不在検出ロジック削除。 |
| **`◐ Working with this human` の wire 未実装** | placeholder copy「For now, see CLAUDE.md for baseline norms」を表示。 | wire 接続後 placeholder 削除。Phase C 範疇。 |
| **`⬢ Cross-unit status` の単一 unit fallback** | `[[unit]]` が 1 つしかない時は section を「単一 unit only」と注記。 | `GET /api/units` 接続後注記削除。Phase C 範疇。 |

### 越境許可の範囲

本来 1-project-N-repo を Producer が扱うべきだが、その基盤自体が未着手なため、**この場限定で WebUI 側コードが tmai-core repo の DR / 状態を直接見に行く越境は許可しない** — 越境を始めると #340 が landed した時の retire が複雑化する。WebUI は **primary cwd の中で完結** し、cross-repo 情報は「無いので空」と正直に出す。

### Unwind 計画

tmai-core issues が landed した時の WebUI 側作業は最小化すべき:

- #340 landed → `useHandover` の repo source を `[cwd]` から `meta.repos[]` に差し替え。grep `TODO(tmai-core#340)` で当該 site 全部出る。
- #341 landed → client-side 不在検出を `meta.missing_preconditions` に差し替え + skeleton 注記の copy 更新。grep `TODO(tmai-core#341)` で site 全部出る。
- 両方 landed → 本 DR の `status:` を `accepted` → `superseded` に変更、`supersedes` を新 DR (もしくは [[2026-05-14-react-producer-console-rebuild]] の Phase C 完了記録) に向ける。

## Non-scope

- **戦略決定の WebUI 表示** — tier-1 戦略 DR (例: `2026-05-13-tmai-is-a-producer-exoskeleton.md`) は **tmai-core 側 private repo** に住んでいる。本 DR の `simulated-onboarded` posture は「WebUI が public 側 DR しか見ないことを正直に出す」までで止める。将来 #340 が landed すれば自然に解決する。
- **Producer 会話の WebUI 内化** — substrate swap 却下 (`2026-05-13-agent-view-does-not-replace-multiplexer-substrate`) は variant せず、本 DR でも terminal-substrate 据え置き。
- **Dispatch / orchestration UI** — Phase B で legacy demote 済 (`2026-05-14-react-producer-console-rebuild`)。本 DR は posture (gap 対応) の話で operator UI の追加 demote は扱わない。

## Why now

dogfood を切らずに反転を進めるには、「core 側が完璧になるまで WebUI を出さない」も「不完全な前提を隠して fabricate する」も両方 不適。**「正直に欠けているものを見せて、core が landed した時に確実に retire できる」という第三の posture を明示的に DR 化** することで、WebUI 側の小さな compensation が「いつ消すべきか不明な永続的な hack」に堕落するのを防ぐ。

## Verification

- `useHandover` 内の placeholder / missing-precondition 検出ロジックに `// TODO(tmai-core#NNN): ...` コメントが揃っている
- 各 gap について `git grep TODO\(tmai-core#340\)` / `TODO\(tmai-core#341\)` で全 site が出る
- 本 DR の `cross-repo-refs` に該当 issue / 上位 DR が並んでいる
- Producer console を tmai-public のみで起動した時、空セクションが「なぜ空か」を表示している (silent empty にはなっていない)

## Update history

- 2026-05-30 (currency re-verify, no change): `#746`（R panel = project artifact inventory, `f32aeba`）が `clients/react/` を変更し governs-path 粒度で drift flag が立ったが、re-verify の結果 **orthogonal** と確認 — #746 の touched files は `App.tsx` / `useIssues.ts` / `ui-prefs.ts` / `AgentList.tsx`（右パネル = artifact inventory の reshape）で、本 posture の load-bearing site（`useHandover.ts` の missing-precondition 検出 + `TODO(tmai-core#341)`、`SettledDecisionsSection.tsx` の `TODO(tmai-core#340)` notice）には未接触。markers 全健在、`#340`/`#341` とも OPEN 据え置きで posture compensation は不変。Decision hold、`status: accepted` 据え置き、`last-verified` のみ bump。
- 2026-05-28 (cross-unit 補償の部分 unwind, verified): Decision-table **row 4**（`⬢ Cross-unit status` の単一 unit fallback notice）を retire — tmai-core **#460**（`GET /api/units` + `GET /api/units/{unit}` membership wire、opt-2 of tmai-core#439）→ public tmai **#741**（types mirror、`UnitsResponse`/`UnitResponse`/`UnitRepoWire`）→ public tmai **#743**（React consumer: `api.units()`/`api.unit()` helpers + `findProducerForUnit` cross-repo オーバーロード〔primary 行 pin、不在時 null〕+ `useHandover` の `api.units()` reconciliation で dormant 設定 unit を state `quiet` で surface + `CrossUnitStatusSection` の `singleUnitOnly` notice 削除 + `TODO(tmai-core#340)` markers 全削除 + `MissingPreconditions.singleUnitOnly` field の type-level 削除）。Membership-only / single-Producer invariant / posture compensation の type-level retirement の 3 契約境界を Producer Δ-review で確認、CI green (build/Analyze×3/CodeQL)。**継続中**: row 2（`noLiveAgents` / onboarding 補償）は `tmai-core#341` OPEN のため据え置き、`MissingPreconditions.noLiveAgents` field と関連 `TODO(tmai-core#341)` markers は健在。row 1（`⬡ Settled decisions` の primary-cwd-only notice）と row 3（`◐ Working with this human` placeholder）は本 workstream の scope 外で別途検証要。Decision の `status` は `accepted` 据え置き（部分 unwind のため）、`last-verified` を bump。
