// WireTerminal — the aim-console's PTY surface (S6): hot-wire ⊥ cold-wire.
//
// One coherent control language for EVERY PTY surface (the Session
// conversation AND each bash-footer terminal), per the design contract
// (`origin/mock/aim-ui-s6` → `assets/s6-conversation-panel-mock.html`):
//
//   · a 3px left spine on the terminal area — INPUT mode = a LIVE wire in
//     the addressee's accent (slow travelling pulse), keystrokes flow to
//     the agent through xterm; SELECT mode = the wire goes COLD
//     ochre/static and the terminal's left edge carries the cold marker;
//   · the accent names the addressee, everywhere — producer cyan / worker
//     violet / shell green (`--who`, a scoped custom property);
//   · a status strip (`StatusStrip`) below: [⌁ INPUT | ⌖ SELECT] · follow ·
//     → addressee · ctx %.
//
// The mock's "input field with caret" is CONCEPTUAL — keystrokes go
// directly into xterm (the CC REPL has its own prompt), so there is NO
// separate text input here. The terminal is the reused `TerminalPanel`
// rendered chromeless with CONTROLLED `inputMode`: the strip's segmented
// control flips the prop, while the panel's own internal semantics
// (mousedown→select, Enter-in-select→input, keyboard attach) stay the
// single implementation and report back via `onInputModeChange`.
//
// `follow` is the same per-agent persisted store the existing footer's
// "⇩ Auto" used (`useAutoScrollPerAgent(agentId)`) — the chromeless
// TerminalPanel's internal consumer of that store picks the toggle up live.

import { useState } from "react";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { useAutoScrollPerAgent } from "@/hooks/useAutoScrollPerAgent";
import { cn } from "@/lib/utils";
import { StatusStrip } from "./StatusStrip";

export type WireWho = "producer" | "worker" | "shell";

interface WireTerminalProps {
  /** Canonical agent id — TerminalPanel subscribes the PTY plane on it. */
  agentId: string;
  /** Addressee kind — picks the hot-wire accent (cyan/violet/green). */
  who: WireWho;
  /** Addressee display name in the strip (`→ {name}`). */
  addressee: string;
  /** ctx % readout in the strip (mirrors the shead); null hides it. */
  ctxPct?: number | null;
  /** Show the one-line mode hint (Session pane yes, footer mini strip no). */
  hint?: boolean;
}

const WHO_CLASS: Record<WireWho, string> = {
  producer: "ac-who-p",
  worker: "ac-who-w",
  shell: "ac-who-sh",
};

export function WireTerminal({
  agentId,
  who,
  addressee,
  ctxPct = null,
  hint = false,
}: WireTerminalProps) {
  // The controlled Input/Select mode — one value shared by the spine, the
  // strip's segmented control, and the chromeless TerminalPanel.
  const [inputMode, setInputMode] = useState(true);
  const [follow, setFollow] = useAutoScrollPerAgent(agentId);

  return (
    <div
      className={cn("ac-wire", WHO_CLASS[who], inputMode ? "input" : "select")}
      data-testid="ac-wire"
      data-wire-mode={inputMode ? "input" : "select"}
    >
      <div className="ac-wire-row">
        <span
          className="ac-spine"
          aria-hidden="true"
          title="hot wire = INPUT(addressee accent) ⊥ cold wire = SELECT(ochre)"
        />
        <div className="ac-wire-term">
          <TerminalPanel
            agentId={agentId}
            chromeless
            inputMode={inputMode}
            onInputModeChange={setInputMode}
          />
        </div>
      </div>
      <StatusStrip
        inputMode={inputMode}
        onModeChange={setInputMode}
        follow={follow}
        onFollowToggle={() => setFollow((v) => !v)}
        addressee={addressee}
        ctxPct={ctxPct}
        hint={hint}
      />
    </div>
  );
}
