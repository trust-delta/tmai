// @vitest-environment jsdom
//
// SlackFace — the AimPane's SLACK face (issue #809): capture box + per-repo
// ore terrain over the generated slack wire. Covers the operator-ratified
// invariants: capture is text only (one textarea, repo target, submit —
// nothing else), submit disabled on empty/whitespace (the client mirror of
// the server's 422), per-repo grouping with reverse-chronological ores,
// the edge-derived quoted marker vs the faint 未採掘 (display only), and the
// two quiet states (empty repo; endpoint unreachable/404 on an older engine).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSlackWire, SlackOreWire, UnitSlackResponse } from "@/lib/api";

const unitSlackMock = vi.fn();
const captureSlackMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    unitSlack: (...args: unknown[]) => unitSlackMock(...args),
    captureSlack: (...args: unknown[]) => captureSlackMock(...args),
  },
}));

import { SlackFace } from "../SlackFace";

function ore(ticket: string, body: string, quoted_by: string[] = []): SlackOreWire {
  return {
    ticket,
    captured_at: `${ticket.slice(0, 10)}T${ticket.slice(11, 13)}:${ticket.slice(13, 15)}:${ticket.slice(15, 17)}`,
    body,
    quoted_by,
  };
}

function repo(label: string, primary: boolean, ores: SlackOreWire[]): RepoSlackWire {
  return { repo_path: `/p/${label}`, repo_label: label, primary, ores };
}

// Two repos, primary first (as the wire returns them). The primary's ores
// arrive ASCENDING by ticket (= capture order) — the terrain must reverse.
function responseStub(
  repos: RepoSlackWire[] = [
    repo("tmai-core", true, [
      ore("2026-06-10-090000", "oldest ore", ["recoil-loop"]),
      ore("2026-06-11-120000", "middle ore\nsecond line"),
      ore("2026-06-11-153000", "newest ore"),
    ]),
    repo("tmai", false, []),
  ],
): UnitSlackResponse {
  return { unit: "u", repos };
}

function renderFace(unitName: string | null = "u") {
  return render(<SlackFace unitName={unitName} />);
}

function captureTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText("slack capture") as HTMLTextAreaElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /置く|置いています/ }) as HTMLButtonElement;
}

beforeEach(() => {
  unitSlackMock.mockReset();
  captureSlackMock.mockReset();
});

describe("SlackFace — terrain (per-repo groups, reverse-chron, markers)", () => {
  it("parks with a placeholder + no fetch when no unit is focused", () => {
    renderFace(null);
    expect(screen.getByText(/プロジェクトを選択/)).toBeTruthy();
    expect(unitSlackMock).not.toHaveBeenCalled();
  });

  it("groups per repo in wire order (primary first) and lists ores newest-first", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    const groups = await screen.findAllByTestId("slack-repo-group");
    expect(groups.map((g) => g.dataset.repo)).toEqual(["tmai-core", "tmai"]);

    // The wire's ascending capture order renders reversed — newest at the top.
    const tickets = within(groups[0])
      .getAllByTestId("slack-ore")
      .map((o) => o.dataset.ticket);
    expect(tickets).toEqual(["2026-06-11-153000", "2026-06-11-120000", "2026-06-10-090000"]);
  });

  it("preserves a multi-line body and shows the compact capture time", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    const middle = (await screen.findAllByTestId("slack-ore")).find(
      (o) => o.dataset.ticket === "2026-06-11-120000",
    );
    expect(middle?.textContent).toContain("middle ore\nsecond line");
    expect(middle?.textContent).toContain("2026-06-11T12:00:00");
  });

  it("marks quoted ores (引用: slug) and unquoted ones 未採掘 — display only", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    const ores = await screen.findAllByTestId("slack-ore");
    const quoted = ores.find((o) => o.dataset.ticket === "2026-06-10-090000");
    const unmined = ores.find((o) => o.dataset.ticket === "2026-06-11-153000");
    if (!quoted || !unmined) throw new Error("fixture ores missing");

    expect(within(quoted).getByTestId("slack-quoted").textContent).toContain("引用: recoil-loop");
    expect(within(quoted).queryByTestId("slack-unmined")).toBeNull();
    expect(within(unmined).getByTestId("slack-unmined").textContent).toBe("未採掘");
    expect(within(unmined).queryByTestId("slack-quoted")).toBeNull();
    // Display only — the marker is never a control.
    expect(within(quoted).getByTestId("slack-quoted").tagName).not.toBe("BUTTON");
    expect(within(unmined).getByTestId("slack-unmined").tagName).not.toBe("BUTTON");
  });

  it("renders a quiet one-liner for a repo with no ores", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    const groups = await screen.findAllByTestId("slack-repo-group");
    expect(within(groups[1]).getByText(/ore なし/)).toBeTruthy();
  });

  it("renders the quiet rebuild-wait note on 404 (older engine, no slack routes)", async () => {
    unitSlackMock.mockRejectedValue(new Error("API error 404: not found"));
    renderFace();
    await waitFor(() =>
      expect(screen.getByText("engine が slack 未対応（rebuild 待ち）")).toBeTruthy(),
    );
  });

  it("renders the same quiet note when the endpoint is unreachable (no API response)", async () => {
    unitSlackMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderFace();
    await waitFor(() =>
      expect(screen.getByText("engine が slack 未対応（rebuild 待ち）")).toBeTruthy(),
    );
  });

  it("surfaces a non-404 API error quietly, with its message", async () => {
    unitSlackMock.mockRejectedValue(new Error("API error 500: walk failed"));
    renderFace();
    await waitFor(() =>
      expect(screen.getByText(/slack の読み込みに失敗: API error 500/)).toBeTruthy(),
    );
  });
});

describe("SlackFace — capture box", () => {
  it("disables submit on empty and whitespace-only text", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    await screen.findAllByTestId("slack-repo-group");

    expect(submitButton().disabled).toBe(true);
    fireEvent.change(captureTextarea(), { target: { value: "   \n\t " } });
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(captureTextarea(), { target: { value: "real ore" } });
    expect(submitButton().disabled).toBe(false);
  });

  it("posts to the primary repo by default, clears the box, and refreshes", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    captureSlackMock.mockResolvedValue(ore("2026-06-11-160000", "raw text, verbatim"));
    renderFace();
    await screen.findAllByTestId("slack-repo-group");

    fireEvent.change(captureTextarea(), { target: { value: "raw text, verbatim" } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(captureSlackMock).toHaveBeenCalledWith("u", {
        repo_path: "/p/tmai-core",
        text: "raw text, verbatim",
      }),
    );
    await waitFor(() => expect(captureTextarea().value).toBe(""));
    // refresh() re-fetches the persisted terrain (initial fetch + 1).
    await waitFor(() => expect(unitSlackMock).toHaveBeenCalledTimes(2));
  });

  it("lets the operator pin another repo — ore never crosses repos", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    captureSlackMock.mockResolvedValue(ore("2026-06-11-160000", "ui ore"));
    renderFace();
    await screen.findAllByTestId("slack-repo-group");

    fireEvent.change(screen.getByLabelText("capture target repo"), {
      target: { value: "/p/tmai" },
    });
    fireEvent.change(captureTextarea(), { target: { value: "ui ore" } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(captureSlackMock).toHaveBeenCalledWith("u", {
        repo_path: "/p/tmai",
        text: "ui ore",
      }),
    );
  });

  it("shows a static repo label (no selector) for a single-repo unit", async () => {
    unitSlackMock.mockResolvedValue(
      responseStub([repo("tmai-core", true, [ore("2026-06-11-120000", "only")])]),
    );
    renderFace();
    await screen.findAllByTestId("slack-repo-group");
    expect(screen.queryByLabelText("capture target repo")).toBeNull();
    expect(screen.getByText("tmai-core", { selector: ".ac-skcap-repo" })).toBeTruthy();
  });

  it("keeps the text and surfaces the message when the POST fails", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    captureSlackMock.mockRejectedValue(new Error("API error 422: empty"));
    renderFace();
    await screen.findAllByTestId("slack-repo-group");

    fireEvent.change(captureTextarea(), { target: { value: "doomed" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("422"));
    // The half-written ore is NOT lost on a failed POST.
    expect(captureTextarea().value).toBe("doomed");
    expect(unitSlackMock).toHaveBeenCalledTimes(1);
  });

  it("captures text only — no category / care-level / importance field", async () => {
    unitSlackMock.mockResolvedValue(responseStub());
    renderFace();
    await screen.findAllByTestId("slack-repo-group");
    const form = screen.getByTestId("slack-capture");
    // One textarea + the repo target select — nothing else collects input.
    expect(form.querySelectorAll("textarea")).toHaveLength(1);
    expect(form.querySelectorAll("input")).toHaveLength(0);
    expect(form.querySelectorAll("select")).toHaveLength(1);
  });
});
