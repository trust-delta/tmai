// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — must precede static imports.

vi.mock("@/lib/api", () => ({
  api: {
    subscribeTerminal: vi.fn(),
    resizeAgentTerminal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../useAgentTerminalStream", () => ({
  useAgentTerminalStream: vi.fn(() => ({ sendKeys: vi.fn() })),
}));

// xterm Terminal and FitAddon are not available in jsdom — provide minimal stubs.

type ResizeCallback = (dims: { rows: number; cols: number }) => void;

interface FakeTerminalInstance {
  rows: number;
  cols: number;
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onBinary: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  onWriteParsed: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  blur: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  _triggerResize: (dims: { rows: number; cols: number }) => void;
}

let lastTermInstance: FakeTerminalInstance | null = null;

vi.mock("@xterm/xterm", () => {
  const makeDisposable = (): { dispose: ReturnType<typeof vi.fn> } => ({ dispose: vi.fn() });

  // Must use `function` (not arrow) so vitest treats this as a constructor.
  function Terminal() {
    const resizeCallbacks: ResizeCallback[] = [];

    const instance: FakeTerminalInstance = {
      rows: 30,
      cols: 120,
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(() => makeDisposable()),
      onBinary: vi.fn(() => makeDisposable()),
      onResize: vi.fn((cb: ResizeCallback) => {
        resizeCallbacks.push(cb);
        return makeDisposable();
      }),
      onWriteParsed: vi.fn(() => makeDisposable()),
      reset: vi.fn(),
      scrollToBottom: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      dispose: vi.fn(),
      _triggerResize(dims) {
        for (const cb of resizeCallbacks) cb(dims);
      },
    };

    lastTermInstance = instance;
    // Return the plain object so `new Terminal()` yields it.
    return instance;
  }

  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
  function FitAddon() {
    return { fit: vi.fn() };
  }
  return { FitAddon };
});

// ResizeObserver is not available in jsdom.
globalThis.ResizeObserver = function ResizeObserver() {
  return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
} as unknown as typeof ResizeObserver;

import { api } from "@/lib/api";
import { useAgentTerminalStream } from "../useAgentTerminalStream";
import { useTerminal } from "../useTerminal";

function makeContainerRef(): React.RefObject<HTMLDivElement> {
  const div = document.createElement("div");
  return { current: div } as React.RefObject<HTMLDivElement>;
}

// Narrow `lastTermInstance` to non-null at call sites without a `!`
// assertion — biome's noNonNullAssertion would auto-rewrite that to `?.`,
// which silently no-ops when the mock failed to register and hides the
// real failure (the resize-event assertion afterwards would then "pass"
// for the wrong reason).
function term(): FakeTerminalInstance {
  if (lastTermInstance === null) {
    throw new Error("Expected fake xterm Terminal to have been constructed");
  }
  return lastTermInstance;
}

describe("useTerminal resize wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastTermInstance = null;
    vi.mocked(api.resizeAgentTerminal).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("calls resizeAgentTerminal with initial terminal dimensions on mount", () => {
    const containerRef = makeContainerRef();

    renderHook(() => useTerminal({ agentId: "cc:agent-1", containerRef }));

    // Should fire immediately (not debounced) after fitAddon.fit().
    expect(api.resizeAgentTerminal).toHaveBeenCalledTimes(1);
    expect(api.resizeAgentTerminal).toHaveBeenCalledWith("cc:agent-1", 30, 120);
  });

  it("calls resizeAgentTerminal after debounce when onResize fires", async () => {
    const containerRef = makeContainerRef();

    renderHook(() => useTerminal({ agentId: "cc:agent-2", containerRef }));

    // Clear the initial call.
    vi.mocked(api.resizeAgentTerminal).mockClear();

    act(() => {
      term()._triggerResize({ rows: 40, cols: 200 });
    });

    // Should not have fired yet — debounce window is 75 ms.
    expect(api.resizeAgentTerminal).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(75);
    });

    expect(api.resizeAgentTerminal).toHaveBeenCalledTimes(1);
    expect(api.resizeAgentTerminal).toHaveBeenCalledWith("cc:agent-2", 40, 200);
  });

  it("collapses rapid resize events into a single call (trailing-edge debounce)", async () => {
    const containerRef = makeContainerRef();

    renderHook(() => useTerminal({ agentId: "cc:agent-3", containerRef }));
    vi.mocked(api.resizeAgentTerminal).mockClear();

    act(() => {
      const t = term();
      t._triggerResize({ rows: 20, cols: 80 });
      t._triggerResize({ rows: 25, cols: 100 });
      t._triggerResize({ rows: 35, cols: 150 });
    });

    await act(async () => {
      vi.advanceTimersByTime(75);
    });

    // Only the last dimension set should be forwarded.
    expect(api.resizeAgentTerminal).toHaveBeenCalledTimes(1);
    expect(api.resizeAgentTerminal).toHaveBeenCalledWith("cc:agent-3", 35, 150);
  });

  it("rewrites CSI arrow sequences to SS3 on egress so CC's bindings fire", () => {
    // CC and other Ink-based TUIs typically sit behind tmux, which serves
    // SS3 arrow sequences (`\x1bOC`, …) regardless of whether the inner
    // program ever flipped DECCKM. Their key bindings — including
    // "accept ghost-text suggestion" on ArrowRight — are wired to SS3, so a
    // bare PTY that ships CSI silently misses the binding. We can't just
    // pre-flip DECCKM via `term.write` on mount because CC reliably emits
    // its own DECCKM disable shortly after attaching, so we rewrite at the
    // egress boundary instead.
    const sendKeysSpy = vi.fn();
    vi.mocked(useAgentTerminalStream).mockReturnValueOnce({
      sendKeys: sendKeysSpy,
    } as unknown as ReturnType<typeof useAgentTerminalStream>);

    const containerRef = makeContainerRef();
    renderHook(() => useTerminal({ agentId: "cc:agent-arrows", containerRef }));

    const t = term();
    // Pull out the onData callback xterm received and feed it CSI arrows
    const onDataCb = t.onData.mock.calls[0][0] as (s: string) => void;

    onDataCb("\x1b[A");
    onDataCb("\x1b[B");
    onDataCb("\x1b[C");
    onDataCb("\x1b[D");
    onDataCb("\x1b[H");
    onDataCb("\x1b[F");
    onDataCb("hello"); // non-arrow data passes through verbatim

    expect(sendKeysSpy.mock.calls.map((c) => c[0])).toEqual([
      "\x1bOA",
      "\x1bOB",
      "\x1bOC",
      "\x1bOD",
      "\x1bOH",
      "\x1bOF",
      "hello",
    ]);
  });

  it("auto-focuses xterm on mount when the hook owns the keyboard", () => {
    // Spawn-then-type relies on this: on every fresh mount of TerminalPanel
    // (forced by the `key={sessionId}` wrapper in App.tsx) the xterm
    // textarea must grab focus so the user doesn't have to click into the
    // panel to start typing.
    const containerRef = makeContainerRef();
    renderHook(() => useTerminal({ agentId: "cc:agent-focus", containerRef }));

    expect(lastTermInstance?.focus).toHaveBeenCalledTimes(1);
  });

  it("does not auto-focus xterm when keys are handled externally", () => {
    // PreviewPanel drives keyboard through its own hidden IME input — if
    // useTerminal also focused xterm, the two would fight over caret
    // ownership and IME composition would land in the wrong target.
    const containerRef = makeContainerRef();
    renderHook(() =>
      useTerminal({ agentId: "cc:agent-preview", containerRef, keysHandledExternally: true }),
    );

    expect(lastTermInstance?.focus).not.toHaveBeenCalled();
  });

  it("cancels pending debounce timer on unmount", async () => {
    const containerRef = makeContainerRef();

    const { unmount } = renderHook(() => useTerminal({ agentId: "cc:agent-4", containerRef }));

    vi.mocked(api.resizeAgentTerminal).mockClear();

    act(() => {
      term()._triggerResize({ rows: 50, cols: 200 });
    });

    // Unmount before the debounce fires.
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(75);
    });

    expect(api.resizeAgentTerminal).not.toHaveBeenCalled();
  });
});
