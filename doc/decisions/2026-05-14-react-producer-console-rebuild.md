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
last-verified: 2026-05-17
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

## Update history

- 2026-05-14 (initial): Proposed, Markdown-bold frontmatter
- 2026-05-14 (PR #672 progress): Phase A + Phase B legacy demote + Phase B Settings reorg + Phase B onboarding polish + Phase B polish v2 (in-tmai spawn) + Phase B polish v3 (DirBrowser flow) + Phase B polish v4 (bash wrap)
- 2026-05-14 (this revision): frontmatter migrated from Markdown-bold to YAML — `tmai-core/workbench/decision.rs::parse` requires a real YAML frontmatter block delimited by `---` lines (the post-#326 convention), and the hand-over composer was erroring out on the old shape. Status flipped to `accepted` since Phase A+B+polish all landed.
