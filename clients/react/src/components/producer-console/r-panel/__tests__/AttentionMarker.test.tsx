// @vitest-environment jsdom
//
// AttentionMarker — the per-artifact attention control (contract
// `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-field.md`
// §3 core). Two responsibilities verified here:
//
//   1. Authorship-scoped coloring — `null` is a machine fact (pending) and
//      stays NEUTRAL (no heat class); `low`/`high` are the operator's own
//      appraisal and carry heat (`attn-low` muted / `attn-high` bright). Color
//      follows authorship: only human-set marks are colored.
//   2. The operator can set `low`/`high` but NEVER `null` — the popover offers
//      exactly two choices, and selecting one calls `onSet` with that level.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type AttentionControls, attentionKey } from "@/hooks/useUnitAttention";
import type { Level } from "@/lib/api";
import { AttentionMarker, RowAttentionMarker } from "../AttentionMarker";

describe("AttentionMarker — authorship-scoped coloring", () => {
  it("null renders a neutral pending marker (machine fact — no heat)", () => {
    render(<AttentionMarker level={null} onSet={vi.fn()} label="#1" />);
    const marker = screen.getByTestId("attention-marker");
    expect(marker.getAttribute("data-level")).toBe("null");
    // Neutral: the subtle-foreground token, and explicitly NOT a heat class.
    expect(marker.className).toContain("text-subtle-foreground");
    expect(marker.className).not.toContain("attn-low");
    expect(marker.className).not.toContain("attn-high");
  });

  it("low renders muted heat (operator appraisal — colored)", () => {
    render(<AttentionMarker level="low" onSet={vi.fn()} label="#1" />);
    const marker = screen.getByTestId("attention-marker");
    expect(marker.getAttribute("data-level")).toBe("low");
    expect(marker.className).toContain("attn-low");
  });

  it("high renders bright heat (operator appraisal — THE thing)", () => {
    render(<AttentionMarker level="high" onSet={vi.fn()} label="#1" />);
    const marker = screen.getByTestId("attention-marker");
    expect(marker.getAttribute("data-level")).toBe("high");
    expect(marker.className).toContain("attn-high");
  });

  it("never colors the machine pole with a CI-severity class", () => {
    const { container } = render(<AttentionMarker level={null} onSet={vi.fn()} label="#1" />);
    // The neutral pole must not leak CI severity (authorship heat ≠ machine
    // severity, and the R panel's negative-space tests blocklist these).
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });
});

describe("AttentionMarker — operator set (low/high only, never null)", () => {
  it("offers exactly low and high — no null/clear/pending choice", () => {
    render(<AttentionMarker level="low" onSet={vi.fn()} label="#1" />);
    fireEvent.click(screen.getByTestId("attention-marker"));

    expect(screen.getByTestId("attention-set-low")).toBeTruthy();
    expect(screen.getByTestId("attention-set-high")).toBeTruthy();
    // Exactly two menu items — the operator cannot disclaim back to null.
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByTestId("attention-set-null")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /pending|clear|none|null/i })).toBeNull();
  });

  it("selecting high calls onSet('high') and closes the menu", () => {
    const onSet = vi.fn();
    render(<AttentionMarker level={null} onSet={onSet} label="#42" />);
    fireEvent.click(screen.getByTestId("attention-marker"));
    fireEvent.click(screen.getByTestId("attention-set-high"));

    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith("high");
    // Menu closed after a choice.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selecting low calls onSet('low')", () => {
    const onSet = vi.fn();
    render(<AttentionMarker level="high" onSet={onSet} label="#42" />);
    fireEvent.click(screen.getByTestId("attention-marker"));
    fireEvent.click(screen.getByTestId("attention-set-low"));
    expect(onSet).toHaveBeenCalledWith("low");
  });

  it("busy disables the marker (no double-POST while one is in flight)", () => {
    render(<AttentionMarker level="low" onSet={vi.fn()} busy label="#1" />);
    const marker = screen.getByTestId("attention-marker") as HTMLButtonElement;
    expect(marker.disabled).toBe(true);
  });

  it("closes the menu on Escape without setting", () => {
    const onSet = vi.fn();
    render(<AttentionMarker level={null} onSet={onSet} label="#1" />);
    fireEvent.click(screen.getByTestId("attention-marker"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSet).not.toHaveBeenCalled();
  });
});

// RowAttentionMarker — the row binding. It threads its row's owning `repoPath`
// into every hook call so two same-numbered artifacts in different repos
// (`tmai` PR#5 vs `tmai-core` PR#5 — #493/#494) drive independent markers.
describe("RowAttentionMarker — threads repoPath to the hook", () => {
  function controls(overrides: Partial<AttentionControls> = {}): AttentionControls {
    return {
      levelFor: () => null,
      setAttention: vi.fn(),
      settingKey: null,
      ...overrides,
    };
  }

  it("passes repoPath through to levelFor and renders the returned level", () => {
    const levelFor = vi.fn((): Level | null => "high");
    render(
      <RowAttentionMarker
        attention={controls({ levelFor })}
        repoPath="tmai-core"
        section="pr"
        id="5"
        label="#5"
      />,
    );
    expect(levelFor).toHaveBeenCalledWith("tmai-core", "pr", "5");
    expect(screen.getByTestId("attention-marker").getAttribute("data-level")).toBe("high");
  });

  it("passes repoPath through to setAttention on a write", () => {
    const setAttention = vi.fn();
    render(
      <RowAttentionMarker
        attention={controls({ setAttention })}
        repoPath="tmai-core"
        section="pr"
        id="5"
        label="#5"
      />,
    );
    fireEvent.click(screen.getByTestId("attention-marker"));
    fireEvent.click(screen.getByTestId("attention-set-high"));
    expect(setAttention).toHaveBeenCalledWith("tmai-core", "pr", "5", "high");
  });

  it("derives busy from the repo-scoped key — same number, different repo is NOT busy", () => {
    // `settingKey` points at `tmai-core` PR#5; this marker is `tmai` PR#5.
    // Pre-fix (key = section+id) they collided and this row would falsely show
    // busy. Now the repo scopes the key, so it stays enabled.
    const marker = (repoPath: string) =>
      render(
        <RowAttentionMarker
          attention={controls({ settingKey: attentionKey("tmai-core", "pr", "5") })}
          repoPath={repoPath}
          section="pr"
          id="5"
          label="#5"
        />,
      );

    const other = marker("tmai");
    expect((other.getByTestId("attention-marker") as HTMLButtonElement).disabled).toBe(false);
    other.unmount();

    // The actually-pending repo's marker IS busy.
    const self = marker("tmai-core");
    expect((self.getByTestId("attention-marker") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders nothing when no attention controls are threaded (opt-in)", () => {
    const { container } = render(
      <RowAttentionMarker repoPath="tmai" section="pr" id="5" label="#5" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
