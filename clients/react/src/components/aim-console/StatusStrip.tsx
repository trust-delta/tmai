// StatusStrip — the aim-console's PTY control strip (S6).
//
// Replaces TerminalPanel's footer (`⌨ Input/📋 Select`, `⇩ Auto` pills)
// within the aim-console with the design contract's `.status` row
// (`origin/mock/aim-ui-s6` → `assets/s6-conversation-panel-mock.html`):
//
//   [⌁ INPUT | ⌖ SELECT]  │  follow  │  → addressee  ·  ctx N%
//
// plus the one-line mode hint in `--faint`. The segmented control DRIVES the
// existing xterm mode semantics (it only flips the controlled `inputMode`
// prop — mousedown→select / Enter-in-select→input stay inside
// TerminalPanel); `follow` replaces "⇩ Auto" over the SAME per-agent
// persisted store (`useAutoScrollPerAgent`, held by the host WireTerminal).
//
// The mock's hint says ⎋ leaves INPUT mode — in the real app Esc is a CC
// REPL keystroke (it interrupts the agent) and the existing semantics have
// no Esc handler, so the hint describes the real exits instead
// (drag-select → SELECT, ⏎ → INPUT).

import { cn } from "@/lib/utils";

interface StatusStripProps {
  /** Resolved Input/Select mode — mirrors the controlled TerminalPanel. */
  inputMode: boolean;
  onModeChange: (inputMode: boolean) => void;
  /** Auto-scroll / follow-tail — the shared per-agent store's value. */
  follow: boolean;
  onFollowToggle: () => void;
  /** Addressee display name (`→ producer` / worker name / shell label). */
  addressee: string;
  /** ctx % readout (mirrors the shead). `null` hides it (shells). */
  ctxPct: number | null;
  /** Render the one-line mode hint under the strip (Session pane). The
   *  bash footer's mini strips omit it. */
  hint?: boolean;
}

export function StatusStrip({
  inputMode,
  onModeChange,
  follow,
  onFollowToggle,
  addressee,
  ctxPct,
  hint = false,
}: StatusStripProps) {
  return (
    <>
      <div className="ac-strip" data-testid="ac-strip">
        <div className="ac-seg2">
          {/* preventDefault on mousedown so clicking the control doesn't
              steal focus from xterm (same trick as terminal/controls.tsx). */}
          <button
            type="button"
            data-mode="input"
            aria-pressed={inputMode}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onModeChange(true)}
            title="Input mode — keystrokes flow to the addressee"
          >
            <span className="lead">⌁</span>INPUT
          </button>
          <button
            type="button"
            data-mode="select"
            aria-pressed={!inputMode}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onModeChange(false)}
            title="Select mode — output text is selectable/copyable"
          >
            <span className="lead">⌖</span>SELECT
          </button>
        </div>
        <span className="ac-dv" aria-hidden="true" />
        <button
          type="button"
          className={cn("ac-follow", follow && "on")}
          aria-pressed={follow}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFollowToggle}
          title="Auto-scroll / follow tail"
        >
          <span className="sw" aria-hidden="true" />
          follow
        </button>
        <span className="ac-dv" aria-hidden="true" />
        <div className="ac-addr" title="宛先 = アクティブ session（tab に従う）">
          <span className="d" aria-hidden="true" />→ <b>{addressee}</b>
        </div>
        {ctxPct !== null && (
          <span className="ac-ctxr">
            ctx <b>{ctxPct}%</b>
          </span>
        )}
      </div>
      {hint && (
        <div className="ac-hint">
          {inputMode ? (
            <span>
              <b>INPUT</b> — キーストロークは agent に渡る。出力をドラッグ選択するか SELECT
              でキーボードを解放してコピー可能に。
            </span>
          ) : (
            <span>
              <b>SELECT</b> — 出力テキストを選択/コピーできる（term 左端も cold wire）。
              <span className="hk">⏎</span> または INPUT でキャプチャへ戻る。
            </span>
          )}
        </div>
      )}
    </>
  );
}
