// @vitest-environment jsdom
//
// AimBody — the agent-authored interior (`AimWire.body`) rendered as markdown.
// Covers: markdown prose actually renders (the gap that left new-form bodies
// invisible), `[[slug]]` cross-edges become clickable nav when resolved + stay
// plain when not, and an empty body renders nothing (a pure-ought node).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AimBody } from "../AimBody";

const resolvesAll = () => true;
const resolvesNone = () => false;
const noop = () => {};

describe("AimBody", () => {
  it("renders the body markdown (heading + list)", () => {
    render(
      <AimBody body={"# 手段\n\n- phase 1\n- phase 2"} resolves={resolvesAll} onNavigate={noop} />,
    );
    // getByText throws if absent, so the lookup itself is the assertion.
    expect(screen.getByText("手段")).toBeTruthy();
    expect(screen.getByText("phase 1")).toBeTruthy();
    expect(screen.getByText("phase 2")).toBeTruthy();
  });

  it("renders a resolved [[slug]] cross-edge as a nav button that calls onNavigate", () => {
    const onNavigate = vi.fn();
    render(
      <AimBody
        body={"depends on [[aim-body]] for the form"}
        resolves={resolvesAll}
        onNavigate={onNavigate}
      />,
    );
    const link = screen.getByRole("button", { name: "aim-body" });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("aim-body");
  });

  it("renders an unresolved [[slug]] as plain text, not a button", () => {
    render(
      <AimBody body={"links to [[not-yet-authored]]"} resolves={resolvesNone} onNavigate={noop} />,
    );
    expect(screen.queryByRole("button", { name: "not-yet-authored" })).toBeNull();
    // The slug text is still shown, just not interactive.
    expect(screen.getByText("not-yet-authored")).toBeTruthy();
  });

  it("renders nothing for an empty / whitespace-only body", () => {
    const { container } = render(
      <AimBody body={"   \n  "} resolves={resolvesAll} onNavigate={noop} />,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("aim-body")).toBeNull();
  });
});
