import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useAutoScrollPerAgent } from "@/hooks/useAutoScrollPerAgent";
import { useTerminal } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";
import { CopySourceOverlay } from "./CopySourceOverlay";
import { AutoScrollToggleButton, ModeHint, ModeToggleButton } from "./controls";
import { TerminalSessionHeader } from "./TerminalSessionHeader";

interface TerminalPanelProps {
  /** Canonical agent id (`<scheme>:<id>`). The terminal-plane stream
   *  scopes on this; ticket subscription happens inside `useTerminal`. */
  agentId: string;
  /** Suppress this panel's own chrome — no `TerminalSessionHeader`, no
   *  footer bar, no focus shadow — for hosts that draw their own (the
   *  aim-console's spine + status strip, #803). Default `false` keeps the
   *  existing rendering unchanged. */
  chromeless?: boolean;
  /** Controlled Input/Select mode (#803). When provided, the host owns the
   *  mode value (e.g. the aim-console status strip); the internal semantics
   *  (mousedown→select, Enter-in-select→input, xterm keyboard attach) stay
   *  this one implementation and report transitions via `onInputModeChange`.
   *  When absent, the original internal `useState` behavior is unchanged. */
  inputMode?: boolean;
  onInputModeChange?: (v: boolean) => void;
}

// Single terminal panel connected to a PTY session via the rev3
// terminal plane (#174 Phase 3a).
// Shares the same Input/Select + Auto-scroll footer pattern as PreviewPanel.
export function TerminalPanel({
  agentId,
  chromeless = false,
  inputMode: inputModeProp,
  onInputModeChange,
}: TerminalPanelProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalInputMode, setInternalInputMode] = useState(true);
  const inputMode = inputModeProp ?? internalInputMode;
  const [hasFocus, setHasFocus] = useState(false);
  const [autoScroll, setAutoScroll] = useAutoScrollPerAgent(agentId);

  // C3: resolve this session's snapshot from the shared SSE agent cache so
  // the header can show model + cwd + ctx% (mirrors ProducerConversationHeader
  // for worker sessions). `target` is the stable key across the
  // provisional→canonical id re-key; fall back to matching `id` too.
  const { agents } = useAgents();
  const agent = useMemo(
    () => agents.find((a) => a.target === agentId || a.id === agentId),
    [agents, agentId],
  );

  const { setAttachable, terminal } = useTerminal({ agentId, containerRef, autoScroll });

  // Surface "this panel is the active surface" — without it, after
  // spawning or switching agents users couldn't tell at a glance whether
  // their next keystroke would land here or get eaten by the body.
  // Track focus on the section wrapper so xterm's helper textarea
  // (mounted inside `containerRef`, a descendant of the section) bubbles
  // focusin/focusout naturally.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onFocusIn = () => setHasFocus(true);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setHasFocus(false);
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Switch to input mode (xterm captures keyboard)
  const enterInputMode = useCallback(() => {
    setInternalInputMode(true);
    onInputModeChange?.(true);
    setAttachable(true);
  }, [setAttachable, onInputModeChange]);

  // Switch to select mode (text selection enabled, keyboard capture off)
  const enterSelectMode = useCallback(() => {
    setInternalInputMode(false);
    onInputModeChange?.(false);
    setAttachable(false);
  }, [setAttachable, onInputModeChange]);

  // Controlled mode: the host can flip `inputMode` from its own UI (the
  // aim-console strip) without going through the handlers above — keep
  // xterm's keyboard attachment in lock-step with the resolved mode.
  // `setAttachable` is idempotent (it guards on the live disposables), so
  // the redundant call after an internal transition is a no-op, as is the
  // mount-time call (the create-effect already attached).
  useEffect(() => {
    setAttachable(inputMode);
  }, [inputMode, setAttachable]);

  // In select mode, listen for Enter key on the container to switch to input mode
  useEffect(() => {
    if (inputMode) return;
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        enterInputMode();
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [inputMode, enterInputMode]);

  return (
    <section
      ref={sectionRef}
      className={
        chromeless
          ? "relative flex h-full w-full flex-col"
          : `relative flex h-full w-full flex-col transition-shadow ${
              hasFocus
                ? "shadow-[inset_0_0_0_2px_rgba(34,211,238,0.55),inset_0_0_24px_rgba(34,211,238,0.06)]"
                : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
            }`
      }
    >
      {!chromeless && <TerminalSessionHeader agentId={agentId} agent={agent} />}
      {/* Relative wrapper so the copy-source affordance (#819) can float over
          the canvas without sitting INSIDE the xterm-owned container div. */}
      <div className="relative flex-1 overflow-hidden">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal container needs pointer events for selection mode */}
        <div
          ref={containerRef}
          className="h-full w-full bg-[var(--color-terminal-background)] p-1"
          onMouseDown={() => {
            if (inputMode) enterSelectMode();
          }}
          onMouseUp={() => {
            if (!inputMode) {
              const sel = window.getSelection();
              if (!sel || sel.toString().length === 0) {
                enterInputMode();
              }
            }
          }}
          onTouchStart={() => {
            // On touch, switch to select mode so text is selectable/copyable
            if (inputMode) enterSelectMode();
          }}
        />
        {/* key: remount on agent switch so the previous session's detected
            blocks (held in hook state for one render) can never flash or be
            copied against the new agent's surface. */}
        <CopySourceOverlay key={agentId} terminalRef={terminal} agentId={agentId} />
      </div>

      {/* Footer status bar */}
      {!chromeless && (
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-1.5">
          <ModeToggleButton
            inputMode={inputMode}
            onToggle={inputMode ? enterSelectMode : enterInputMode}
          />
          <AutoScrollToggleButton
            autoScroll={autoScroll}
            onToggle={() => setAutoScroll((v) => !v)}
          />
          <div className="flex-1" />
          <ModeHint inputMode={inputMode} />
        </div>
      )}
    </section>
  );
}
