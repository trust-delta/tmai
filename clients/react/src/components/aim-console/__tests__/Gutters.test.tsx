// @vitest-environment jsdom
//
// S7 drag-resizable layout test — the pane gutters (Aim|Session, Session|PR)
// and the bash-footer height gutter, plus the `aimConsoleLayout` ui-prefs
// persistence. The drag engine works imperatively (CSS custom properties per
// move, ONE prefs write on pointerup), so the assertions read the inline
// custom properties off the root / footer and the persisted blob out of
// localStorage.
//
// jsdom has no real layout: every pane the gutters measure gets its
// getBoundingClientRect stubbed, and pointer capture (absent in jsdom) is
// try/catch-guarded in the engine itself.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import type {
  AgentSnapshot,
  AimsResponse,
  SlotResponse,
  UnitIssuesResponse,
  UnitPrsResponse,
} from "@/lib/api";
import {
  AIM_CONSOLE_LAYOUT_DEFAULTS,
  loadUIPrefs,
  UI_PREFS_STORAGE_KEY,
  type UIPrefs,
} from "@/lib/ui-prefs";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import { AimConsole } from "../AimConsole";
import { BashFooter } from "../BashFooter";

// Park every fetch/spawn in flight — the layout tests are data-agnostic.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      aims: () => new Promise<AimsResponse>(() => {}),
      unitPrs: () => new Promise<UnitPrsResponse>(() => {}),
      unitIssues: () => new Promise<UnitIssuesResponse>(() => {}),
      spawnPty: () => new Promise<{ session_id: string; pid: number; command: string }>(() => {}),
    },
  };
});

const UNITS: SlotResponse[] = [
  {
    name: "tmai",
    repos: [
      { path: "/home/u/tmai", primary: true },
      { path: "/home/u/tmai-core", primary: false },
    ],
  },
];

function renderConsole() {
  render(
    <UIPrefsProvider>
      <ConfirmProvider>
        <AimConsole
          units={UNITS}
          activeUnitName="tmai"
          onSelectUnit={vi.fn()}
          onAddUnit={vi.fn()}
          onCloseUnit={vi.fn()}
          agents={[] as AgentSnapshot[]}
          currentProjectPath="/home/u/tmai"
          trigger={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </ConfirmProvider>
    </UIPrefsProvider>,
  );
}

// jsdom reports zero-size rects; give the panes the gutters measure a real
// footprint. Only the dimensions the engine reads are filled in.
function stubRect(el: Element, size: { width?: number; height?: number }) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: size.width ?? 0,
    bottom: size.height ?? 0,
    width: size.width ?? 0,
    height: size.height ?? 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function drag(sep: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(sep, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  fireEvent.pointerMove(sep, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(sep, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

function storedLayout(): UIPrefs["aimConsoleLayout"] {
  return loadUIPrefs().aimConsoleLayout;
}

function seedLayout(layout: NonNullable<UIPrefs["aimConsoleLayout"]>) {
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ aimConsoleLayout: layout }));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ConvAimGutter — Conversation|Aim pane gutter", () => {
  function setup() {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    stubRect(root.querySelector(".ac-session") as Element, { width: 700 });
    const sep = screen.getByRole("separator", { name: "Resize Conversation / Aim panes" });
    return { root, sep };
  }

  it("rewrites --conv per move and persists ONCE on pointerup", () => {
    const { root, sep } = setup();
    fireEvent.pointerDown(sep, { clientX: 700, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 760, clientY: 300, pointerId: 1 });

    // Live: the conversation anchor widens with the pointer (700 + 60)…
    expect(root.style.getPropertyValue("--conv")).toBe("760px");
    // …with the mono readout chip showing the live px…
    expect(screen.getByTestId("ac-gutter-readout").textContent).toBe("conv 760px");
    // …but NOTHING persisted yet (written on drag end, not per-move).
    expect(storedLayout()).toBeNull();

    fireEvent.pointerUp(sep, { clientX: 760, clientY: 300, pointerId: 1 });
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, conv: 760 });
    expect(screen.queryByTestId("ac-gutter-readout")).toBeNull();
  });

  it("clamps the anchor width to [360, 1400]px", () => {
    const { root, sep } = setup();
    // Far left: conv floors at 360.
    drag(sep, { x: 700, y: 300 }, { x: 0, y: 300 });
    expect(root.style.getPropertyValue("--conv")).toBe("360px");
    // Far right: conv caps at 1400.
    drag(sep, { x: 700, y: 300 }, { x: 2400, y: 300 });
    expect(root.style.getPropertyValue("--conv")).toBe("1400px");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, conv: 1400 });
  });

  it("double-click resets to the default anchor width and clears the stored layout", () => {
    const { root, sep } = setup();
    drag(sep, { x: 700, y: 300 }, { x: 760, y: 300 });
    expect(storedLayout()).not.toBeNull();

    fireEvent.doubleClick(sep);
    expect(storedLayout()).toBeNull();
    expect(root.style.getPropertyValue("--conv")).toBe("720px");
  });
});

describe("AimRemoteGutter — Aim|Remote gutter (docked only)", () => {
  // Open the Remote, then dock it (the gutter is inert while collapsed AND
  // while overlaid — only the docked column is drag-resizable).
  function openAndDock() {
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    fireEvent.click(screen.getByRole("button", { name: "Dock the Remote panel" }));
  }

  it("is inert while the Remote is collapsed", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    const sep = screen.getByRole("separator", { name: "Resize Remote panel" });
    expect(sep.className).toContain("off");
    stubRect(root.querySelector(".ac-pr") as Element, { width: 46 });
    drag(sep, { x: 1000, y: 300 }, { x: 900, y: 300 });
    fireEvent.doubleClick(sep);
    expect(root.style.getPropertyValue("--pr")).toBe("");
    expect(storedLayout()).toBeNull();
  });

  it("is inert while the Remote is OVERLAID (open but not docked)", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    const sep = screen.getByRole("separator", { name: "Resize Remote panel" });
    // Overlay is the default open mode — the edge gutter stays inert.
    expect(sep.className).toContain("off");
  });

  // The dock GUARD boundary: maxDockable = console − conversation − gutters −
  // DOCK_MIN_AIM (400). With console 1500 + conversation 700 → 1500-700-10-400 =
  // 390px. So the Remote docks while ≤ 390 (Aim keeps its floor) and floats when
  // wider (Aim would be crushed).
  function stubDockGeometry(root: Element) {
    stubRect(root.querySelector(".ac-main") as Element, { width: 1500 });
    stubRect(root.querySelector(".ac-session") as Element, { width: 700 });
  }

  it("resizes the docked Remote while it still fits beside Aim (stays docked)", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    openAndDock();
    expect(root.style.getPropertyValue("--pr")).toBe("360px");
    expect(root.className).toContain("remote-dock");
    stubDockGeometry(root);

    const sep = screen.getByRole("separator", { name: "Resize Remote panel" });
    expect(sep.className).not.toContain("off");
    stubRect(root.querySelector(".ac-pr") as Element, { width: 360 });

    // Narrow to 380 (≤ 390 maxDockable) → still fits → stays docked, persists.
    drag(sep, { x: 1000, y: 300 }, { x: 980, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("380px");
    expect(root.className).toContain("remote-dock");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, pr: 380 });

    fireEvent.doubleClick(sep);
    expect(storedLayout()).toBeNull();
    expect(root.style.getPropertyValue("--pr")).toBe("360px");
  });

  it("widening a docked panel until Aim would be crushed floats it back to overlay", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    openAndDock();
    expect(root.className).toContain("remote-dock");
    stubDockGeometry(root);
    const sep = screen.getByRole("separator", { name: "Resize Remote panel" });
    stubRect(root.querySelector(".ac-pr") as Element, { width: 360 });

    // 360 - (-100) = 460 > 390 → Aim would drop below its floor → floats.
    drag(sep, { x: 1000, y: 300 }, { x: 900, y: 300 });
    expect(root.className).not.toContain("remote-dock");
    expect(root.className).toContain("remote-open");
  });
});

describe("OverlayEdgeGutter — drag the overlay edge (dock when it fits)", () => {
  const NAME = "Resize Remote overlay";

  // Same guard geometry as above: maxDockable 390px.
  function stubDockGeometry(root: Element) {
    stubRect(root.querySelector(".ac-main") as Element, { width: 1500 });
    stubRect(root.querySelector(".ac-session") as Element, { width: 700 });
    stubRect(root.querySelector(".ac-prfull") as Element, { width: 360 });
  }

  it("exists only while overlaid (open, not docked)", () => {
    renderConsole();
    expect(screen.queryByRole("separator", { name: NAME })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    expect(screen.getByRole("separator", { name: NAME })).toBeTruthy();
  });

  it("drag-to-dock: releasing at a width that fits beside Aim docks it", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    expect(root.className).toContain("remote-open");
    expect(root.className).not.toContain("remote-dock");
    stubDockGeometry(root);

    const sep = screen.getByRole("separator", { name: NAME });
    // 360 → 380 (≤ 390 maxDockable) → fits → docks on release.
    drag(sep, { x: 1000, y: 300 }, { x: 980, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("380px");
    expect(root.className).toContain("remote-dock");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, pr: 380 });
  });

  it("stays overlay when released too wide to fit beside Aim", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    stubDockGeometry(root);

    const sep = screen.getByRole("separator", { name: NAME });
    // 360 → 460 (> 390 maxDockable) → Aim would be crushed → stays overlay.
    drag(sep, { x: 1000, y: 300 }, { x: 900, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("460px");
    expect(root.className).not.toContain("remote-dock");
    expect(root.className).toContain("remote-open");
  });

  it("signals a pending FLIP mid-drag (amber class + 'release to dock' readout), cleared on release", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    stubDockGeometry(root);
    const sep = screen.getByRole("separator", { name: NAME });

    // Mid-drag to 380 (≤ 390 → would DOCK, a flip from overlay) — no release yet.
    fireEvent.pointerDown(sep, { clientX: 1000, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 980, clientY: 300, pointerId: 1 });
    expect(root.className).toContain("remote-pending-flip");
    expect(screen.getByTestId("ac-gutter-readout").textContent).toContain("release to dock");

    // Release clears the flip signal.
    fireEvent.pointerUp(sep, { clientX: 980, clientY: 300, pointerId: 1 });
    expect(root.className).not.toContain("remote-pending-flip");
  });

  it("shows NO flip signal while the drag stays in the same mode", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    stubDockGeometry(root);
    const sep = screen.getByRole("separator", { name: NAME });

    // Mid-drag to 460 (> 390 → would stay OVERLAY, no flip).
    fireEvent.pointerDown(sep, { clientX: 1000, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 900, clientY: 300, pointerId: 1 });
    expect(root.className).not.toContain("remote-pending-flip");
    expect(screen.getByTestId("ac-gutter-readout").textContent).not.toContain("release");
    fireEvent.pointerUp(sep, { clientX: 900, clientY: 300, pointerId: 1 });
  });
});

describe("FooterGutter — bash-footer height gutter", () => {
  function renderFooter() {
    render(
      <UIPrefsProvider>
        <div className="aim-console">
          <div className="ac-col ac-session" data-testid="session-col">
            <BashFooter repos={[]} primaryPath="/home/u/tmai" agents={[]} />
          </div>
        </div>
      </UIPrefsProvider>,
    );
  }

  it("is only present while the footer is expanded", () => {
    renderFooter();
    expect(screen.queryByRole("separator", { name: "Resize bash footer height" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));
    expect(screen.getByRole("separator", { name: "Resize bash footer height" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse bash footer" }));
    expect(screen.queryByRole("separator", { name: "Resize bash footer height" })).toBeNull();
  });

  it("drags --fh within [110px, 60% of the session pane] and persists on pointerup", () => {
    renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));

    const session = screen.getByTestId("session-col");
    stubRect(session, { height: 600 }); // ceiling = 360
    stubRect(session.querySelector(".ac-ftwrap") as Element, { height: 180 });
    const footer = screen.getByTestId("aim-bash-footer");
    expect(footer.style.getPropertyValue("--fh")).toBe("180px");

    const sep = screen.getByRole("separator", { name: "Resize bash footer height" });
    // Dragging UP grows the footer: 180 - (-50) = 230.
    fireEvent.pointerDown(sep, { clientX: 400, clientY: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 400, clientY: 450, pointerId: 1 });
    expect(footer.style.getPropertyValue("--fh")).toBe("230px");
    expect(screen.getByTestId("ac-gutter-readout").textContent).toBe("footer 230px");
    expect(storedLayout()).toBeNull(); // not yet — drag end persists
    fireEvent.pointerUp(sep, { clientX: 400, clientY: 450, pointerId: 1 });
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, footer: 230 });

    // Clamp floor (110) and the 60%-of-session ceiling (360).
    drag(sep, { x: 400, y: 500 }, { x: 400, y: 900 });
    expect(footer.style.getPropertyValue("--fh")).toBe("110px");
    drag(sep, { x: 400, y: 500 }, { x: 400, y: 0 });
    expect(footer.style.getPropertyValue("--fh")).toBe("360px");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, footer: 360 });

    // Double-click resets to 180 and clears the all-default blob.
    fireEvent.doubleClick(sep);
    expect(storedLayout()).toBeNull();
    expect(footer.style.getPropertyValue("--fh")).toBe("180px");
  });

  it("refuses to start a drag when the session is so short the clamp would invert", () => {
    renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));

    const session = screen.getByTestId("session-col");
    // ceiling = round(150 * 0.6) = 90 <= the 110px floor → min/max would
    // invert and commit a below-min height; onStart must bail instead.
    stubRect(session, { height: 150 });
    stubRect(session.querySelector(".ac-ftwrap") as Element, { height: 180 });
    const footer = screen.getByTestId("aim-bash-footer");
    const sep = screen.getByRole("separator", { name: "Resize bash footer height" });

    drag(sep, { x: 400, y: 500 }, { x: 400, y: 900 });
    // The drag never engaged: no live --fh write, no readout, no persistence.
    expect(footer.style.getPropertyValue("--fh")).toBe("180px");
    expect(screen.queryByTestId("ac-gutter-readout")).toBeNull();
    expect(storedLayout()).toBeNull();
  });

  it("re-applies the 60% ceiling on window resize without persisting it", () => {
    seedLayout({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, footer: 300 });
    renderFooter();
    const session = screen.getByTestId("session-col");
    stubRect(session, { height: 600 }); // ceiling 360 — 300 fits
    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));
    const footer = screen.getByTestId("aim-bash-footer");
    expect(footer.style.getPropertyValue("--fh")).toBe("300px");

    // The session pane shrinks (window resize): ceiling 0.6*400 = 240.
    stubRect(session, { height: 400 });
    fireEvent(window, new Event("resize"));
    expect(footer.style.getPropertyValue("--fh")).toBe("240px");
    // The transient clamp is NOT written back — the stored 300 survives.
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, footer: 300 });
  });
});

describe("aimConsoleLayout prefs round-trip", () => {
  it("restores a stored layout on mount (anchor, remote, footer)", () => {
    seedLayout({ conv: 820, pr: 400, footer: 240 });
    renderConsole();
    const root = screen.getByTestId("aim-console");
    // The conversation anchor applies immediately.
    expect(root.style.getPropertyValue("--conv")).toBe("820px");
    // The Remote width applies once it opens.
    expect(root.style.getPropertyValue("--pr")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    expect(root.style.getPropertyValue("--pr")).toBe("400px");
    // The footer restores its stored height when expanded.
    fireEvent.click(screen.getByRole("button", { name: "Expand bash footer" }));
    expect(screen.getByTestId("aim-bash-footer").style.getPropertyValue("--fh")).toBe("240px");
  });

  it("coerces a corrupt / out-of-range stored layout on load", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ aimConsoleLayout: { conv: 9999, pr: 9999, footer: 12 } }),
    );
    // Out-of-range px values clamp to their windows (conv → 1400, pr → 520).
    expect(loadUIPrefs().aimConsoleLayout).toEqual({ conv: 1400, pr: 520, footer: 110 });

    // A non-object blob (or an all-defaults one) normalises to null.
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ aimConsoleLayout: "garbage" }));
    expect(loadUIPrefs().aimConsoleLayout).toBeNull();
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ aimConsoleLayout: { ...AIM_CONSOLE_LAYOUT_DEFAULTS } }),
    );
    expect(loadUIPrefs().aimConsoleLayout).toBeNull();
  });
});
