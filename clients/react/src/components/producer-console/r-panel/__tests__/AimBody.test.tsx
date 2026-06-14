// @vitest-environment jsdom
//
// AimBody — the agent-authored interior (`AimWire.body`) rendered as STRUCTURED
// sections. Covers: a structured body renders its sections as labelled blocks
// in canonical order with empty canonical slots surfaced; `[[slug]]` cross-edges
// become clickable nav when resolved + stay plain when not; the means-progress
// (実装済/未実装) chip; a pure-prose body skips the scaffold; an empty body
// renders nothing.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AimBody } from "../AimBody";

const all = () => true;
const none = () => false;
const noop = () => {};

const DRIFT_BODY = [
  "# 手段",
  "",
  "drift 表面化機構（means・未実装）",
  "",
  "- 入力はローカル git の行レベル履歴",
  "",
  "# DAG",
  "",
  "- 依存: [[git-local-fact-source]]",
].join("\n");

describe("AimBody", () => {
  it("renders sections in canonical order with empty slots (rpanel)", () => {
    render(<AimBody body={DRIFT_BODY} variant="rpanel" resolves={all} onNavigate={noop} />);
    const sections = screen.getAllByTestId("aim-body-section");
    expect(sections.map((s) => s.getAttribute("data-kind"))).toEqual([
      "obstacle",
      "means",
      "dag",
      "history",
    ]);
    // obstacle + history are absent → empty slots; means + dag carry content.
    expect(sections[0].getAttribute("data-empty")).toBe("true");
    expect(sections[3].getAttribute("data-empty")).toBe("true");
    expect(sections[1].getAttribute("data-empty")).toBeNull();
    expect(screen.getByText(/drift 表面化機構/)).toBeTruthy();
    expect(screen.getByText(/入力はローカル git/)).toBeTruthy();
  });

  it("surfaces the means 未実装 progress chip", () => {
    render(<AimBody body={DRIFT_BODY} variant="rpanel" resolves={all} onNavigate={noop} />);
    // The chip text is exactly the glyph + status (the prose mention is a longer
    // string, so an exact match hits only the chip).
    expect(screen.getByText("◌ 未実装")).toBeTruthy();
  });

  it("renders a resolved [[slug]] cross-edge as a nav button calling onNavigate", () => {
    const onNavigate = vi.fn();
    render(
      <AimBody
        body={"# DAG\n\n- 依存 [[git-local-fact-source]]"}
        variant="rpanel"
        resolves={all}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "git-local-fact-source" }));
    expect(onNavigate).toHaveBeenCalledWith("git-local-fact-source");
  });

  it("renders an unresolved [[slug]] as plain text, not a button", () => {
    render(
      <AimBody
        body={"# DAG\n\n- [[not-yet-authored]]"}
        variant="rpanel"
        resolves={none}
        onNavigate={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "not-yet-authored" })).toBeNull();
    expect(screen.getByText("not-yet-authored")).toBeTruthy();
  });

  it("renders a pure-prose body verbatim, without the canonical scaffold", () => {
    render(
      <AimBody
        body={"just a note, no headings"}
        variant="rpanel"
        resolves={all}
        onNavigate={noop}
      />,
    );
    // No canonical empty slots are forced onto a non-conforming body.
    expect(screen.queryByText("障害 — escalation")).toBeNull();
    expect(screen.getByText(/just a note/)).toBeTruthy();
  });

  it("renders the console variant's sections", () => {
    render(<AimBody body={DRIFT_BODY} variant="console" resolves={all} onNavigate={noop} />);
    const sections = screen.getAllByTestId("aim-body-section");
    expect(sections.some((s) => s.getAttribute("data-kind") === "means")).toBe(true);
    expect(screen.getByText(/drift 表面化機構/)).toBeTruthy();
  });

  it("renders nothing for an empty / whitespace-only body", () => {
    const { container } = render(
      <AimBody body={"   \n  "} variant="rpanel" resolves={all} onNavigate={noop} />,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("aim-body")).toBeNull();
  });
});
