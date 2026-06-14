// @vitest-environment jsdom
//
// AimBody — the agent-authored interior (`AimWire.body`) rendered as STRUCTURED
// sections. Covers: the canonical is/障害/手段/DAG/history scaffold (reading
// order + empty slots); the 手段 progress checklist (status glyphs + done/todo
// ratio); `[[slug]]` cross-edges (clickable when resolved, plain when not); a
// pure-prose body skipping the scaffold; an empty body rendering nothing.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AimBody } from "../AimBody";

const all = () => true;
const none = () => false;
const noop = () => {};

const DRIFT_BODY = [
  "# is — 前提",
  "",
  "- git 行レベル履歴が安価に取れる",
  "",
  "# 手段",
  "",
  "drift 表面化機構",
  "",
  "- [未実装] within-node: aim 行 ts vs body ts",
  "- [実装済] 既存 parser split_frontmatter",
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
      "is",
      "obstacle",
      "means",
      "dag",
      "history",
    ]);
    // is / means / dag carry content; obstacle + history are empty slots.
    expect(sections[1].getAttribute("data-empty")).toBe("true"); // obstacle
    expect(sections[4].getAttribute("data-empty")).toBe("true"); // history
    expect(sections[0].getAttribute("data-empty")).toBeNull(); // is
    expect(screen.getByText(/git 行レベル履歴/)).toBeTruthy();
  });

  it("renders 手段 as a progress checklist with a done/todo ratio", () => {
    render(<AimBody body={DRIFT_BODY} variant="rpanel" resolves={all} onNavigate={noop} />);
    expect(screen.getByTestId("aim-means-progress").textContent).toContain("実装 1 / 未実装 1");
    const items = screen.getAllByTestId("aim-means-item");
    expect(items.map((i) => i.getAttribute("data-status"))).toEqual(["todo", "done"]);
    expect(screen.getByText(/within-node/)).toBeTruthy();
    expect(screen.getByText(/既存 parser/)).toBeTruthy();
  });

  it("falls back to a section status chip when means items carry no markers", () => {
    render(
      <AimBody
        body={"# 手段\n\nfoo（means・未実装）\n\n- a detail bullet"}
        variant="rpanel"
        resolves={all}
        onNavigate={noop}
      />,
    );
    // No marked items → no ratio badge, but the prose 未実装 surfaces as a chip.
    expect(screen.queryByTestId("aim-means-progress")).toBeNull();
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
    expect(screen.queryByText("障害 — escalation")).toBeNull();
    expect(screen.getByText(/just a note/)).toBeTruthy();
  });

  it("renders the console variant's sections", () => {
    render(<AimBody body={DRIFT_BODY} variant="console" resolves={all} onNavigate={noop} />);
    const sections = screen.getAllByTestId("aim-body-section");
    expect(sections.some((s) => s.getAttribute("data-kind") === "means")).toBe(true);
    expect(screen.getByTestId("aim-means-progress").textContent).toContain("実装 1 / 未実装 1");
  });

  it("renders nothing for an empty / whitespace-only body", () => {
    const { container } = render(
      <AimBody body={"   \n  "} variant="rpanel" resolves={all} onNavigate={noop} />,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("aim-body")).toBeNull();
  });
});
