---
status: accepted
category: scoped
tier: 2
governs:
  - clients/react/
cross-repo-refs:
  - "tmai-core:doc/decisions/2026-05-11-orchestration-locus-inversion.md"
  - "tmai-core:doc/decisions/2026-05-11-producer-only-operator-interface.md"
  - "tmai-core:doc/decisions/2026-05-11-producer-conversation-workbench.md"
  - "tmai-core:doc/decisions/2026-05-12-producer-layer-topology.md"
  - "tmai-core:doc/decisions/2026-05-13-tmai-is-a-producer-exoskeleton.md"
  - "tmai-core:doc/decisions/2026-05-13-agent-view-does-not-replace-multiplexer-substrate.md"
  - "tmai-core:doc/decisions/2026-05-13-producer-feedback-loop-and-decision-tiers.md"
last-verified: 2026-05-23
contract-surface: false
related:
  - "2026-04-21-monorepo-reconsolidation"
  - "2026-04-24-snapshot-contract"
  - "2026-05-14-webui-simulated-onboarded-posture"
---

# React WebUI を Producer console に再構築する（段階差し替え）

**Date:** 2026-05-14
**Tier:** 2 (methodology — tier 付与は Producer↔人間 合意で確定)

## Context

`clients/react/` の WebUI は 2026-05 反転前の「人間が N agent を直接捌く orchestrator cockpit」前提で組まれている:

- `AgentList`（左サイドバー）が primary navigation。人間が agent を選んで `PreviewPanel` (xterm + 直接 prompt 入力) で会話する
- `NewAgentLauncher` で人間が DirBrowser + runtime picker から manual spawn
- `SettingsPanel` の `OrchestrationSection` + `DispatchBundleEditor` で人間が orchestrator config を編集
- `WorktreePanel` / `IssueActionView` に「Dispatch Issue」「Create Worktree」ボタン
- `AgentCard` の `attention: started/halted/completed` pill = 人間が状態を読んで動く前提

しかし tmai-core で landed した反転（cross-refs 参照）はこれを supersede している:

> tmai is a Producer's exoskeleton + a human console. Orchestration logic lives in
> the Producer's reasoning, not in tmai code. Workers are invisible to the
> operator; their output routes through the Producer. The substrate for the
> Producer conversation is the existing terminal multiplexer (tmux/wezTerm/native),
> not a WebUI-internal Agent View.

PR #671 で「Producer console」の入口は既に立ち上がっている: `CalibrationChip`（StatusBar の ⚡N）/ `TripwireBanner`（ホイスト、ゼロ寛容アラート）/ `CalibrationPanel`（read-only な Producer hit-rate）/ `useCalibration`（90s polling `/api/units/{unit}/calibration`）。これらは新モデルに整合していて、起点として活きる。

## Decision

`clients/react/` を **Producer console** として再構築する。方針は以下の 4 軸で確定（2026-05-14 セッション）:

| 軸 | 決定 |
|---|---|
| Scope | **段階差し替え** — dogfood を切らずに PR #671 surface を主役に昇格させ、orchestrator-era UI を順次降格 |
| Main view | **Hand-over digest 中心** — `▶ Where you left off / ⬢ Cross-unit status / ⬡ Settled decisions / ◐ Working with this human` の 4 セクション構成（tmai-core `2026-05-13-producer-feedback-loop-and-decision-tiers` の hand-over 仕様に準拠） |
| Legacy controls | **Advanced 奥に退避して保持** — 撤去はしない（`feedback_pty_emergency_terminal_access` の精神で human override 経路は残す）。ただしメイン動線からは外す |
| Producer chat | **terminal substrate のまま** — WebUI は「Open Producer terminal」launch affordance のみ持つ。Producer 会話用の panel を WebUI 内に持つことは substrate swap になるので却下（cross-ref `2026-05-13-agent-view-does-not-replace-multiplexer-substrate`） |

### Target composition (text mock)

```
┌─ ⚡ Tier-1 Tripwire (N)  ──────────────── Details ▸ ┐
│   (only shown when tier1_violations is non-empty)   │
└─────────────────────────────────────────────────────┘

▶ Where you left off
  - active worktree (branch, dispatched briefs)
  - open briefs awaiting human

⬢ Cross-unit status
  - 1 line per unit (🔴 needs-you / 🟡 in-progress / ⚪ quiet)

⬡ Settled decisions     [📌 foundational] [🔴 in-play] [🟡 warm] [⚪ cold]
  - top N by temperature; click → DR view

◐ Working with this human
  - deltas from baseline CLAUDE.md / norm reminders

[ Open Producer terminal ▸ ]  [ Calibration ▸ ]  [ Operator override ▾ ]
```

### Phase plan

**Phase A — WebUI 内完結（既存 wire のみ）**
- `components/producer-console/ProducerConsole.tsx` + 4 セクション sub-components を新設
- App.tsx の default を `ProducerConsole` に切替（既存 routing は壊さない）
- セクション wire-up:
  - `⚡ Tripwire` band → 既存 `useCalibration` の `tier1_violations`
  - `▶ Where you left off` → `useAgents` から active worktree / queued briefs を導出
  - `⬢ Cross-unit status` → 既存 `GET /api/projects` + `[[unit]]` 設定から導出
  - `⬡ Settled decisions` → **Phase A は client-side placeholder**（wire が後追い）
  - `◐ Working with this human` → 同上 placeholder
- `[Open Producer terminal ▸]` ボタン → v1 は clipboard copy fallback。専用 endpoint は Phase D で検討
- AgentList は subsidiary に降格（折りたたみで残す、default 閉じる）

**Phase B — Legacy demote**
- `NewAgentLauncher` / `PreviewPanel` の直接 prompt 入力 / `OrchestrationSection` / `DispatchBundleEditor` / `WorktreePanel`-`IssueActionView` の dispatch ボタンを「Operator override」expandable に集約
- `SettingsPanel` のタブ並び替え: Producer 関連（calibration / unit / general）が primary、orchestration bundles は Advanced タブへ
- `AgentCard` 状態 pill は Operator override 内のみ表示。Producer console 本体には raw agent state を出さない

**Phase C — Wire 拡張（tmai-core 連携、cross-repo work）**
- `GET /api/units/{unit}/hand-over` — composed `▶⬢⬡◐` payload を返す（Producer は session-start で内部 compose しているので endpoint 化が gap）
- `GET /api/units` — units 列挙 + cross-unit summary
- `GET /api/units/{unit}/decisions` — decision-record frontmatter + temperature
- SSE: `CoreEvent::HandOverUpdated` / `CalibrationUpdated`（polling → push）
- これらは tmai-core 側の作業を伴う。Phase B 完了後に DR を private 側で別途起こす

**Phase D — Polish**
- Cross-unit ナビゲーション ergonomics
- 「Open Producer terminal」の実 launch 経路（clipboard fallback から専用 endpoint or MCP に移行検討）
- Visual: tripwire severity ramp / decision temperature glyph / `▶⬢⬡◐` typography 整え
- Idempotent Producer launch（既存 Producer に attach する tmai-core-side ensure endpoint）

## 非範囲（NOT 構築するもの）

- **WebUI 内 Producer chat panel**: substrate swap になるので却下（cross-ref `2026-05-13-agent-view-does-not-replace-multiplexer-substrate`）
- **Worker queue / per-worker dashboard / parallel task timeline**: 「workers are invisible to operator」原則違反
- **Legacy orchestrator-era UI の物理削除**: Advanced 奥に退避するのみ、削除はしない（emergency override 経路として温存）
- **`useTerminal.ts` / `globals.css` への変更**: 別作業者の active workpiece (xterm v6 scrollbar 統一)、独立して進行中

## 帰結 / Open questions

- **Tier**: Tier 2 (methodology) で確定（2026-05-14 セッション、ユーザー承認済）
- **`is_orchestrator` agent flag**: Phase B で WebUI 側は読まなくなる方向だが、wire 上の field は tmai-core 側で残る可能性あり。Phase C で要 cross-repo 議論
- **「Open Producer terminal」launch 方式**: Phase A は clipboard fallback → Phase B polish v2 で `api.spawnPty` 経由の in-tmai launch に移行 → Phase B polish v4 で tmai-core spawn allow-list を回避するため `bash -c 'exec tmai producer "$0"' unit` で wrap。長期的には tmai-core 側で Producer 専用 endpoint or allow-list 拡張（Phase D）
- **Multi-unit (cross-unit) navigation の primary affordance**: top bar の unit picker vs sidebar の unit list、Phase D で decide

## Implementation order (Phase A)

Branch: `feat/react-producer-console`（2026-05-14 切り出し、PR #672）

1. `components/producer-console/` 新設、`ProducerConsole.tsx` + section sub-components
2. `hooks/useHandover.ts` 新設（既存 wire 集約 + placeholder セクション）
3. `App.tsx` の routing 変更（default = ProducerConsole、AgentList を subsidiary に）
4. Sidebar 構造調整（AgentList を折りたたみに、Operator override panel の足場を仮置き）
5. Test: ProducerConsole composition / 各 section の rendering / placeholder 切替
6. Lint / typecheck / build (`pnpm` 系) を pass
7. PR を `fix/...` ではなく `feat/...` で出す（CLAUDE.md の慣行）。本 DR を PR description で参照

## Refinement 2026-05-22 — L/C/R co-visible layout (operator-decided)

**Lived friction:** in-tmai merge が github.com 往復を消した今、次の注意税は digest↔会話の **screen switch**。Phase A の現状は `ProducerConsole` が agent 未選択時だけ `<main>` を占有し、agent（Producer 会話 = `PreviewPanel`）を選ぶと**置き換わる**（`returnToConsole` で復帰）。digest と会話が同時に見えない＝[[2026-05-11-review-attention-budget-principle]] が batch せよと言う per-event switching cost そのもの。

**Decision（operator, 2026-05-22）:** 単一 `<main>` の「digest か会話か」モデルを **3 カラム co-visible** に進化させる:
- **左** — agent/worker 面（今回不変、改良は後回し）。
- **中央** — Producer 会話（端末）。単一ペイン。git/docs マルチペインは撤去。
- **右** — **常設アテンション strip**、中央と常時 co-visible。operator は status を読むのに会話を離れない。`returnToConsole` と `selection===null` の digest 画面は vestigial 化。

**Fork A — 右は薄い dumb strip、重い文脈は on-demand:** 右カラムは attention-grade のみ（open PR + CI / cross-unit needs-you / blocked・awaiting agents / verdict 待ち approach）。重い文脈（`⬡ Settled decisions` 全リスト・`◐ Working with this human`/MEMORY）は on-demand briefing（session-start / expand）へ。これにより右面は [[2026-05-20-provisional-pre-producer-dashboard]] の **dumb status surface 原則**（優先度スカラー・異常ソート・3 帯域 judgment を忍ばせない）に準拠 — 本作業は同 approach の strip surface の WebUI 実現でもある。

**Fork B — git/docs マルチペイン撤去（P2）:** `BranchGraph`（worktree/ ツリー）・`MarkdownPanel`・Tabbed/Split/Triple pane レイアウト・`useSplitPane`・display-mode UI-prefs・`WorktreePanel`/`WorktreeCard` を撤去。**`DiffViewer` は残す**（`UnitPrsSection` の PR inline-diff が live 依存）。`BranchGraph` 内の worktree-delete / issue-start-work **アクションは全撤去**（Producer が reap + dispatch を所有、operator は worktree ボタンでなく Producer に話す）。
  > **⚠ 本 DR の原 stance を narrow する。** 2026-05-14 の軸「Legacy controls — Advanced 奥に退避して保持・撤去はしない」と 非範囲「Legacy orchestrator-era UI の物理削除…削除はしない」を、worktree-delete / issue-dispatch 管理ボタンについては **部分 supersede**（物理削除、Advanced 保持しない）。これは `feedback_pty_emergency_terminal_access` に**反しない**: 同原則が守るのは緊急時の *worker 直接会話端末* 経路であり（これは保持）、worktree/issue *管理* ボタンの保持は要求しない。**P2 dispatch 時に operator が再確認**。

**Fork C — phasing:** **P1** = アテンション右常設化（摩擦解消・中央会話と右 strip を co-visible・高価値低リスク）。**P2** = git/docs マルチペイン + legacy アクション撤去（cleanup、Fork-B supersession を担う）。各 phase = bounded worker。

**P1.1 — lived-feedback adjustment（2026-05-23、operator）:** P1 (#722) を実使用して 2 点判明: (i) strip 幅が固定で drag 調整できない、(ii) ▣ verdict 待ち approach は変化が遅く常時表示の必要が薄い（start-orientation であって継続 attention でない）。調整: strip 幅を **drag-resizable** に（`useSplitPane` 再利用 + `attentionStripWidth` pref）、**▣ approaches を strip から外し start-briefing（中央 digest）へ**、strip は 🔀 PR+CI / ⬢ needs-you / ▶ blocked-awaiting を保持（▶ は strip では「Blocked / awaiting」に改名、digest の full ▶ は不変）。**strip content 規則の精緻化**: *session 中に変化して目を要する* = strip / *開始時に一度読む orientation* = briefing。これにより Fork A の「右は dumb attention 面」がより鋭くなる。

**Grounding（2026-05-22 Explore）:** `App.tsx` がレイアウト本体（shell/router なし、flex 2 カラム + state-switched views）。`ProducerConsole`（6 自己完結セクション、各自 data hook）は dock-ready だが幅制約 + 狭カラム用 header/footer 再考が要る。`DiffViewer` は BranchGraph 撤去後も生存必須。第三者 split-pane lib なし（hand-rolled `useSplitPane`）。

## Update history

- 2026-05-14 (initial): Proposed, Markdown-bold frontmatter
- 2026-05-14 (PR #672 progress): Phase A + Phase B legacy demote + Phase B Settings reorg + Phase B onboarding polish + Phase B polish v2 (in-tmai spawn) + Phase B polish v3 (DirBrowser flow) + Phase B polish v4 (bash wrap)
- 2026-05-14 (this revision): frontmatter migrated from Markdown-bold to YAML — `tmai-core/workbench/decision.rs::parse` requires a real YAML frontmatter block delimited by `---` lines (the post-#326 convention), and the hand-over composer was erroring out on the old shape. Status flipped to `accepted` since Phase A+B+polish all landed.
- 2026-05-22 (refinement): added § "Refinement 2026-05-22 — L/C/R co-visible layout". Operator-decided 3-column layout (L agent / C conversation / R persistent attention dumb-strip) to kill the digest↔conversation screen-switch; phased P1 (attention-right) → P2 (git/docs multipane + legacy-action retire). Fork B partially supersedes the original "legacy controls retained in Advanced, never removed" stance for worktree-delete/issue-dispatch buttons (emergency direct-worker-terminal path retained). Converges with `2026-05-20-provisional-pre-producer-dashboard`. P1 landed via PR #722.
- 2026-05-23 (P1.1 lived-feedback): added § "P1.1 — lived-feedback adjustment". First use of P1 → strip width made drag-resizable; ▣ verdict-awaiting approaches moved out of the strip to the start-briefing (slow-changing = orientation, not continuous attention); strip retains 🔀 PR+CI / ⬢ needs-you / ▶ blocked-awaiting (▶ relabeled "Blocked / awaiting" in the strip). Sharpens the strip-content rule: changes-during-session = strip; read-once-at-start = briefing.
- 2026-05-23 (#725 conversation reachability): the handoff trigger + ctx% readout, previously digest-only, made reachable from inside the Producer **conversation** via a new `ProducerConversationHeader` (gated to the Producer; workers keep `AgentActions`). The handoff ritual's overlay / failure-dialog / ready-toast lifted to App level (single `useHandoffRitual` instance) so they stay co-visible from any view. Closes the manual-kill trap — the digest-only button was invisible mid-conversation. Pairs with the tmai-core matcher fix (`9ff7870`, TUI-glyph-tolerant `HANDOFF READY` detection). Merged `2e99c1c`.
- 2026-05-23 (#726 conversation-bar compaction, lived-feedback): the Producer conversation stacked three chrome bars (AgentActions + ProducerConversationHeader + TerminalPanel id row) eating conversation height. Merged into ONE compact bar for the Producer (status dot + name + compact ctx% + `auto@N%` + Handoff + Kill + ⚙; full `used/total` in tooltip); non-Producer `AgentActions` and the digest's full `ProducerCtxHeader` unchanged. Producer gate compares the stable `target` (not re-keyable `id`). Merged `24bf6c8`. **In lived-use validation** (operator running it via `pnpm dev`).
- 2026-05-23 (left-panel stance refined → [[2026-05-23-producer-rooted-left-panel]]): the "sidebar = legacy escape hatch, flat agent registry retained" stance here is **partially superseded**. A 2026-05-23 left-panel purpose discussion found the flat `AgentList` is stale vs the operator-addresses-Producer / `<unit>.producer.worker[]` identity decisions; the left panel is re-cast as a Producer-rooted **addressing surface** (Producer headline + workers as subordinate roster; emergency direct-worker + spawn retained, folded). Emergency-operability preserved, so `feedback_pty_emergency_terminal_access` is not violated. Implementation is a follow-up serving dispatch.
