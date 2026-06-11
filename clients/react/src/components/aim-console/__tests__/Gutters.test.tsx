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
import type {
  AgentSnapshot,
  AimsResponse,
  UnitIssuesResponse,
  UnitPrsResponse,
  UnitResponse,
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

vi.mock("@/hooks/useUnitAttention", () => ({
  useUnitAttention: () => ({ data: null, loading: false, error: null }),
}));

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

const UNITS: UnitResponse[] = [
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
      <AimConsole
        units={UNITS}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onExit={vi.fn()}
        agents={[] as AgentSnapshot[]}
        currentProjectPath="/home/u/tmai"
        trigger={vi.fn()}
        onOpenSettings={vi.fn()}
      />
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

describe("AimSessionGutter — Aim|Session pane gutter", () => {
  function setup() {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    stubRect(root.querySelector(".ac-aim") as Element, { width: 590 });
    stubRect(root.querySelector(".ac-session") as Element, { width: 500 });
    const sep = screen.getByRole("separator", { name: "Resize Aim / Session panes" });
    return { root, sep };
  }

  it("rewrites --aim/--sess per move and persists ONCE on pointerup", () => {
    const { root, sep } = setup();
    fireEvent.pointerDown(sep, { clientX: 600, clientY: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 650, clientY: 300, pointerId: 1 });

    // Live: the fr tracks follow the pointer (590+50 / 500-50 of total 1090)…
    expect(root.style.getPropertyValue("--aim")).toBe("640fr");
    expect(root.style.getPropertyValue("--sess")).toBe("450fr");
    // …with the mono readout chip showing the live px…
    expect(screen.getByTestId("ac-gutter-readout").textContent).toBe("aim 640px · sess 450px");
    // …but NOTHING persisted yet (written on drag end, not per-move).
    expect(storedLayout()).toBeNull();

    fireEvent.pointerUp(sep, { clientX: 650, clientY: 300, pointerId: 1 });
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, aim: 640, sess: 450 });
    // The chip is gone once the drag ends.
    expect(screen.queryByTestId("ac-gutter-readout")).toBeNull();
  });

  it("clamps at both ends: aim >= 230px and session >= 300px", () => {
    const { root, sep } = setup();
    // Far left: aim floors at 230 (total 1090 → sess 860).
    drag(sep, { x: 600, y: 300 }, { x: 0, y: 300 });
    expect(root.style.getPropertyValue("--aim")).toBe("230fr");
    expect(root.style.getPropertyValue("--sess")).toBe("860fr");

    // Far right: session floors at 300 (aim caps at 1090-300=790).
    drag(sep, { x: 600, y: 300 }, { x: 1900, y: 300 });
    expect(root.style.getPropertyValue("--aim")).toBe("790fr");
    expect(root.style.getPropertyValue("--sess")).toBe("300fr");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, aim: 790, sess: 300 });
  });

  it("double-click resets to the defaults and clears the stored layout", () => {
    const { root, sep } = setup();
    drag(sep, { x: 600, y: 300 }, { x: 650, y: 300 });
    expect(storedLayout()).not.toBeNull();

    fireEvent.doubleClick(sep);
    // Back to the untouched defaults — stored layout CLEARED, not re-pinned.
    expect(storedLayout()).toBeNull();
    expect(root.style.getPropertyValue("--aim")).toBe("1.18fr");
    expect(root.style.getPropertyValue("--sess")).toBe("1fr");
  });
});

describe("SessionPrGutter — Session|PR rail gutter", () => {
  it("is inert while the rail is collapsed", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    const sep = screen.getByRole("separator", { name: "Resize PR rail" });
    expect(sep.className).toContain("off");

    stubRect(root.querySelector(".ac-pr") as Element, { width: 46 });
    drag(sep, { x: 1000, y: 300 }, { x: 900, y: 300 });
    fireEvent.doubleClick(sep);
    // No live track write, no persistence — the gutter ignored everything.
    expect(root.style.getPropertyValue("--pr")).toBe("");
    expect(storedLayout()).toBeNull();
  });

  it("drags the open rail within 240–520px and persists on pointerup", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    // Open: the inline --pr carries the persisted (default) width.
    expect(root.style.getPropertyValue("--pr")).toBe("320px");

    const sep = screen.getByRole("separator", { name: "Resize PR rail" });
    expect(sep.className).not.toContain("off");
    stubRect(root.querySelector(".ac-pr") as Element, { width: 320 });

    // Pointer left = wider rail: 320 - (-100) = 420.
    drag(sep, { x: 1000, y: 300 }, { x: 900, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("420px");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, pr: 420 });

    // Clamp floor (240) and ceiling (520).
    drag(sep, { x: 1000, y: 300 }, { x: 1900, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("240px");
    drag(sep, { x: 1000, y: 300 }, { x: 0, y: 300 });
    expect(root.style.getPropertyValue("--pr")).toBe("520px");
    expect(storedLayout()).toEqual({ ...AIM_CONSOLE_LAYOUT_DEFAULTS, pr: 520 });

    // Double-click resets the rail width (and clears the all-default blob).
    fireEvent.doubleClick(sep);
    expect(storedLayout()).toBeNull();
    expect(root.style.getPropertyValue("--pr")).toBe("320px");
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
  it("restores a stored layout on mount (panes, rail, footer)", () => {
    seedLayout({ aim: 700, sess: 380, pr: 400, footer: 240 });
    renderConsole();
    const root = screen.getByTestId("aim-console");
    expect(root.style.getPropertyValue("--aim")).toBe("700fr");
    expect(root.style.getPropertyValue("--sess")).toBe("380fr");
    // The rail width applies once the rail opens.
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
      JSON.stringify({ aimConsoleLayout: { aim: -3, sess: "x", pr: 9999, footer: 12 } }),
    );
    // Bad fr weights fall back per-field; px values clamp to their windows.
    expect(loadUIPrefs().aimConsoleLayout).toEqual({
      aim: AIM_CONSOLE_LAYOUT_DEFAULTS.aim,
      sess: AIM_CONSOLE_LAYOUT_DEFAULTS.sess,
      pr: 520,
      footer: 110,
    });

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
