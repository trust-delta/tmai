// @vitest-environment jsdom
//
// AimPane — the aim-console's Aim (left) pane (S2). A faithful reproduction of
// the destination mock's `.aim` section + create-aim modal in the dev-tool
// tokens, wired to the REUSED Stage B logic layer (`r-panel/aim-tree.ts`,
// `useUnitAims`, `api.createAim` / `api.editAim`). This test covers the
// presentation port against the real wire shape: the ledger, the Frontier owed
// worklist (drift-first, breadcrumbed, done-drift distinct — pin #2), the Tree
// navigator (grouping + rollups + collapse), the overview ruler reveal, the
// inspector (drift pill + interior is[] — pin #1 mark-only), the search filter,
// and the create / edit modal (kebab validation + refetch — pin #3).
//
// Mirrors RAimsSection.test.tsx's fixtures (same forest) so the two surfaces
// stay behaviourally comparable; only the markup/queries differ.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AimsResponse, AimWire } from "@/lib/api";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimInteriorWire } from "@/types/generated/AimInteriorWire";

const aimsMock = vi.fn();
const createAimMock = vi.fn();
const editAimMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      aims: (...args: unknown[]) => aimsMock(...args),
      createAim: (...args: unknown[]) => createAimMock(...args),
      editAim: (...args: unknown[]) => editAimMock(...args),
    },
  };
});

import { AimPane } from "../AimPane";

function driftFrom(slug: string): AimDriftWire {
  return {
    stale_from_ancestor_slug: slug,
    ancestor_change_sha: "abc1234",
    ancestor_change_date: "2026-06-01",
    aim_change_date: "2026-05-01",
  };
}
const claimed = (text: string): AimInteriorWire => ({ kind: "claimed", text, ref: null });
const confirmed = (text: string, ref: string): AimInteriorWire => ({
  kind: "confirmed",
  text,
  ref,
});

function aimStub(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
  return {
    aim: `aim ${overrides.slug}`,
    parent: null,
    state: "open",
    depends_on: [],
    serves: [],
    related: [],
    body: "",
    drift: null,
    is: [],
    ...overrides,
  };
}

// Two repos (same shape as RAimsSection's fixture):
//   tmai-core (primary)
//     amplify-human-judgment (root, open, claimed)               → owed (claimed)
//       attention-per-artifact (open, drift←amplify, conf+claim)  → owed (drift)
//         attention-backend (done, confirmed)                     → plain done
//     aim-system (root, open, confirmed)                          → calm
//       aim-honesty (dead)                                        → abandoned
//       review-attention-budget (done, drift←aim-system)          → PIN #2
//   tmai
//     inverted-ui (root, open, claimed)                           → owed (claimed)
const CORE: AimWire[] = [
  aimStub({ slug: "amplify-human-judgment", aim: "amplify judgment", is: [claimed("進行中")] }),
  aimStub({
    slug: "attention-per-artifact",
    aim: "per-artifact attention",
    parent: "amplify-human-judgment",
    drift: driftFrom("amplify-human-judgment"),
    is: [confirmed("storage + wire", "PR#490"), claimed("ancestor moved — re-confirm")],
  }),
  aimStub({
    slug: "attention-backend",
    aim: "backend compute",
    parent: "attention-per-artifact",
    state: "done",
    is: [confirmed("wired", "PR#500")],
  }),
  aimStub({
    slug: "aim-system",
    aim: "records as structure",
    is: [confirmed("graduated", "PR#501")],
  }),
  aimStub({ slug: "aim-honesty", aim: "confirmed ⊥ claimed", parent: "aim-system", state: "dead" }),
  aimStub({
    slug: "review-attention-budget",
    aim: "review budget is the limiter",
    parent: "aim-system",
    state: "done",
    drift: driftFrom("aim-system"),
  }),
];
const UI: AimWire[] = [
  aimStub({ slug: "inverted-ui", aim: "root to conversation", is: [claimed("frontier")] }),
];

function responseStub(
  repos: { label: string; primary: boolean; aims: AimWire[] }[] = [
    { label: "tmai-core", primary: true, aims: CORE },
    { label: "tmai", primary: false, aims: UI },
  ],
): AimsResponse {
  return {
    unit: "u",
    composed_at: "2026-06-08T00:00:00Z",
    repos: repos.map((r) => ({
      repo_label: r.label,
      repo_root: `/p/${r.label}`,
      primary: r.primary,
      repo_head: null,
      aims: r.aims,
    })),
  };
}

function renderPane(unitName: string | null = "u") {
  return render(
    <UIPrefsProvider>
      <AimPane unitName={unitName} />
    </UIPrefsProvider>,
  );
}

function rowEl(slug: string): HTMLElement {
  const el = document.querySelector(`[data-testid="aim-row"][data-slug="${slug}"]`);
  if (!el) throw new Error(`no row for ${slug}`);
  return el as HTMLElement;
}
function selectRow(slug: string) {
  // The select button is the one carrying aria-pressed (toggle / add buttons do not).
  const btn = rowEl(slug).querySelector("button[aria-pressed]");
  if (!btn) throw new Error(`no select button for ${slug}`);
  fireEvent.click(btn);
}

beforeEach(() => {
  localStorage.clear();
  aimsMock.mockReset();
  createAimMock.mockReset();
  editAimMock.mockReset();
});

describe("AimPane — load + ledger", () => {
  it("parks with a placeholder + no fetch when no unit is focused", () => {
    renderPane(null);
    expect(screen.getByText(/プロジェクトを選択/)).toBeTruthy();
    expect(aimsMock).not.toHaveBeenCalled();
  });

  it("surfaces a fetch error", async () => {
    aimsMock.mockRejectedValue(new Error("boom"));
    renderPane();
    await waitFor(() => expect(screen.getByText(/読み込みに失敗: boom/)).toBeTruthy());
  });

  it("ledger counts drift / claimed / confirmed off the forest", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    const ledger = await screen.findByTestId("aim-ledger");
    // drift=2 (attention-per-artifact open + review-attention-budget done; dead
    // excluded), claimed marks=3, confirmed marks=3.
    await waitFor(() => expect(ledger.textContent).toMatch(/2\s*drift/));
    expect(ledger.textContent).toMatch(/3\s*claimed/);
    expect(ledger.textContent).toMatch(/3\s*confirmed/);
  });
});

describe("AimPane — Frontier mode (owed worklist)", () => {
  it("defaults to Frontier, lists owed drift-first, calm absent, done-drift distinct", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await waitFor(() => expect(rowEl("attention-per-artifact").dataset.tone).toBe("drift"));
    expect(rowEl("amplify-human-judgment").dataset.tone).toBe("claimed");
    // A calm (confirmed-only) node is NOT in the worklist.
    expect(document.querySelector('[data-testid="aim-row"][data-slug="aim-system"]')).toBeNull();
    // Owed in the non-primary repo too.
    expect(rowEl("inverted-ui").dataset.tone).toBe("claimed");

    // Pin #2: done+drift surfaced distinctly, with its badge, in its own cluster.
    const r = rowEl("review-attention-budget");
    expect(r.dataset.tone).toBe("done-drift");
    expect(within(r).getByTestId("aim-drift-badge")).toBeTruthy();
    expect(screen.getByText(/done · drifted/)).toBeTruthy();
  });

  it("breadcrumbs each owed row with its ought-ancestry", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await waitFor(() =>
      expect(rowEl("attention-per-artifact").textContent).toContain("amplify-human-judgment"),
    );
  });

  it("shows a calm message when nothing is owed", async () => {
    aimsMock.mockResolvedValue(
      responseStub([
        {
          label: "tmai-core",
          primary: true,
          aims: [aimStub({ slug: "calm", is: [confirmed("ok", "PR#1")] })],
        },
      ]),
    );
    renderPane();
    await waitFor(() => expect(screen.getByText(/盤面は calm/)).toBeTruthy());
  });
});

describe("AimPane — Tree mode (per-repo navigator + rollups)", () => {
  it("groups by repo (primary highlighted) and rolls up a collapsed branch", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const heads = await screen.findAllByTestId("aim-repo-head");
    expect(heads.map((h) => h.dataset.repo)).toEqual(["tmai-core", "tmai"]);
    expect(heads[0].className).toContain("pri");

    // amplify is a root → open by default; collapse it.
    const toggle = rowEl("amplify-human-judgment").querySelector('button[aria-label^="Collapse"]');
    fireEvent.click(toggle as Element);
    // Its child is now hidden, and the rollup shows the subtree drift (⚠1).
    expect(
      document.querySelector('[data-testid="aim-row"][data-slug="attention-per-artifact"]'),
    ).toBeNull();
    expect(within(rowEl("amplify-human-judgment")).getByTestId("aim-rollup").textContent).toContain(
      "⚠1",
    );
  });

  it("a search in Tree mode shows a flat, repo-tagged hit list", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    fireEvent.change(screen.getByLabelText("Filter aims"), { target: { value: "aim-system" } });
    expect(rowEl("aim-system")).toBeTruthy();
    // The flat hit carries the repo tag.
    expect(rowEl("aim-system").textContent).toContain("tmai-core");
  });
});

describe("AimPane — overview ruler", () => {
  it("clicking a lit tick reveals the node in Tree mode and selects it", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ruler");

    const tick = await waitFor(() => {
      const t = document.querySelector(
        '[data-testid="ruler-tick"][data-slug="attention-per-artifact"]',
      );
      if (!t) throw new Error("no tick yet");
      return t;
    });
    expect(tick.getAttribute("data-owed")).toBe("drift");
    fireEvent.click(tick);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("aim-inspector").textContent).toContain("per-artifact attention");
  });
});

describe("AimPane — inspector", () => {
  it("shows the drift←ancestor pill and the interior is[] (mark-only, ref for confirmed)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    selectRow("attention-per-artifact");

    const insp = await screen.findByTestId("aim-inspector");
    expect(within(insp).getByTestId("aim-drift-pill").textContent).toContain(
      "drift ← 祖先 amplify-human-judgment",
    );
    const marks = within(insp).getAllByTestId("aim-mark");
    expect(marks.map((m) => m.dataset.kind)).toEqual(["confirmed", "claimed"]);
    expect(marks[0].textContent).toContain("PR#490");
    expect(marks[1].textContent).toContain("ancestor moved");
  });

  it("breadcrumb climbs to an ancestor", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    selectRow("attention-per-artifact");
    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /amplify judgment/ }));
    await waitFor(() =>
      expect(screen.getByTestId("aim-inspector").textContent).toContain("amplify judgment"),
    );
  });
});

describe("AimPane — search", () => {
  it("filters the owed worklist by slug / ought", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");

    fireEvent.change(screen.getByLabelText("Filter aims"), { target: { value: "per-artifact" } });
    expect(rowEl("attention-per-artifact")).toBeTruthy();
    expect(
      document.querySelector('[data-testid="aim-row"][data-slug="amplify-human-judgment"]'),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter aims"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText(/filter 一致なし/)).toBeTruthy();
  });
});

describe("AimPane — create modal", () => {
  it("creates via the modal and reflects it after the refetch", async () => {
    const created = aimStub({ slug: "new-node", aim: "the new bearing" });
    aimsMock.mockResolvedValueOnce(responseStub());
    aimsMock.mockResolvedValue(
      responseStub([
        { label: "tmai-core", primary: true, aims: [...CORE, created] },
        { label: "tmai", primary: false, aims: UI },
      ]),
    );
    createAimMock.mockResolvedValue(created);

    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));

    const modal = await screen.findByTestId("aim-create-modal");
    fireEvent.change(within(modal).getByLabelText(/aim — /), {
      target: { value: "the new bearing" },
    });
    fireEvent.change(within(modal).getByLabelText(/slug — /), { target: { value: "new-node" } });
    fireEvent.click(within(modal).getByRole("button", { name: "作成" }));

    await waitFor(() =>
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "new-node",
        aim: "the new bearing",
        parent: null,
      }),
    );
    // Pin #3: a create triggers a refetch.
    await waitFor(() => expect(aimsMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getAllByText("the new bearing").length).toBeGreaterThan(0));
  });

  it("auto-derives the slug from the aim until the operator types one", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    const modal = await screen.findByTestId("aim-create-modal");
    fireEvent.change(within(modal).getByLabelText(/aim — /), {
      target: { value: "Attention icon row" },
    });
    expect((within(modal).getByLabelText(/slug — /) as HTMLInputElement).value).toBe(
      "attention-icon-row",
    );
  });

  it("blocks a dated slug and a duplicate without calling the API", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    const modal = await screen.findByTestId("aim-create-modal");

    fireEvent.change(within(modal).getByLabelText(/aim — /), { target: { value: "a" } });
    fireEvent.change(within(modal).getByLabelText(/slug — /), {
      target: { value: "2026-01-02-x" },
    });
    expect(within(modal).getByText("日付 prefix 不可")).toBeTruthy();
    expect(within(modal).getByRole("button", { name: "作成" })).toHaveProperty("disabled", true);

    fireEvent.change(within(modal).getByLabelText(/slug — /), { target: { value: "aim-system" } });
    expect(within(modal).getByText("slug 重複")).toBeTruthy();
    expect(createAimMock).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection inline", async () => {
    aimsMock.mockResolvedValue(responseStub());
    createAimMock.mockRejectedValue(new Error("aim 'racy' already exists"));
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    const modal = await screen.findByTestId("aim-create-modal");
    fireEvent.change(within(modal).getByLabelText(/aim — /), { target: { value: "a" } });
    fireEvent.change(within(modal).getByLabelText(/slug — /), { target: { value: "racy" } });
    fireEvent.click(within(modal).getByRole("button", { name: "作成" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
  });

  it("Esc closes the modal", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    await screen.findByTestId("aim-create-modal");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("aim-create-modal")).toBeNull());
  });

  it("add-child from the inspector presets the parent", async () => {
    aimsMock.mockResolvedValue(responseStub());
    createAimMock.mockResolvedValue(
      aimStub({ slug: "child", aim: "c", parent: "amplify-human-judgment" }),
    );
    renderPane();
    await screen.findByTestId("aim-ledger");
    selectRow("amplify-human-judgment");
    fireEvent.click(await screen.findByRole("button", { name: /子 aim/ }));

    const modal = await screen.findByTestId("aim-create-modal");
    expect((within(modal).getByLabelText("parent") as HTMLSelectElement).value).toBe(
      "amplify-human-judgment",
    );
    fireEvent.change(within(modal).getByLabelText(/aim — /), { target: { value: "c" } });
    fireEvent.change(within(modal).getByLabelText(/slug — /), { target: { value: "child" } });
    fireEvent.click(within(modal).getByRole("button", { name: "作成" }));

    await waitFor(() =>
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "child",
        aim: "c",
        parent: "amplify-human-judgment",
      }),
    );
  });
});

describe("AimPane — edit modal (pin #3: drift mirrors the engine on refetch)", () => {
  it("edits aim / state via the modal and refetches (no client cascade)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    editAimMock.mockResolvedValue(
      aimStub({ slug: "aim-system", aim: "edited bearing", state: "done" }),
    );
    renderPane();
    await screen.findByTestId("aim-ledger");
    // Edit from Tree mode so the calm (non-owed) aim-system is reachable.
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("aim-system");

    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /編集/ }));

    const modal = await screen.findByTestId("aim-create-modal");
    // Edit mode: slug frozen.
    expect((within(modal).getByLabelText(/slug — /) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(modal).getByLabelText(/aim — /), {
      target: { value: "edited bearing" },
    });
    fireEvent.change(within(modal).getByLabelText("state"), { target: { value: "done" } });
    fireEvent.click(within(modal).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(editAimMock).toHaveBeenCalledWith("u", "aim-system", {
        aim: "edited bearing",
        parent: null,
        state: "done",
      }),
    );
    await waitFor(() => expect(aimsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("excludes the node + its descendants from the edit parent options (no cycles)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("amplify-human-judgment");
    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /編集/ }));

    const modal = await screen.findByTestId("aim-create-modal");
    const parentSelect = within(modal).getByLabelText("parent") as HTMLSelectElement;
    const values = Array.from(parentSelect.options).map((o) => o.value);
    expect(values).not.toContain("amplify-human-judgment"); // self
    expect(values).not.toContain("attention-per-artifact"); // descendant
    expect(values).not.toContain("attention-backend"); // deeper descendant
    expect(values).toContain("aim-system"); // outside subtree → allowed
  });
});

describe("AimPane — mode persistence", () => {
  it("persists the Frontier/Tree mode across remounts (ui-prefs)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    const { unmount } = renderPane();
    await screen.findByTestId("aim-ledger");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe("true");

    unmount();
    renderPane();
    await screen.findByTestId("aim-ledger");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });
});
