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
const unitSlackMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      aims: (...args: unknown[]) => aimsMock(...args),
      createAim: (...args: unknown[]) => createAimMock(...args),
      editAim: (...args: unknown[]) => editAimMock(...args),
      unitSlack: (...args: unknown[]) => unitSlackMock(...args),
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
const pruned = (text: string, ref: string | null = null): AimInteriorWire => ({
  kind: "pruned",
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
    working_delta: null,
    is: [],
    ...overrides,
  };
}

// Two repos (same shape as RAimsSection's fixture):
//   tmai-core (primary)
//     amplify-human-judgment (root, open, claimed)               → owed (claimed)
//       attention-per-artifact (open, drift←amplify,
//                               conf+claim+pruned)                 → owed (drift)
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
    is: [
      confirmed("storage + wire", "PR#490"),
      claimed("ancestor moved — re-confirm"),
      pruned("CLI-flag route", "wrong premise — judgment lives in records"),
    ],
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

// "Forest is in" signal. The ledger renders DURING loading, so it is NOT a
// load gate; the "＋ aim" button, by contrast, enables only once the forest
// (with a primary repo) has loaded (`primaryRepo !== null`). Any test that
// interacts with loaded data must await this first — otherwise the interaction
// can land on the loading-state render and silently no-op (e.g. a disabled
// "＋ aim" click never opens the modal).
async function awaitLoaded() {
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: "New aim" }) as HTMLButtonElement;
    if (btn.disabled) throw new Error("forest not loaded yet");
  });
}

beforeEach(() => {
  localStorage.clear();
  aimsMock.mockReset();
  createAimMock.mockReset();
  editAimMock.mockReset();
  unitSlackMock.mockReset();
  // The SLACK face mounts (hidden) alongside the AIM face, so its hook always
  // fetches — give it a benign default with ores present, so the no-badge
  // assertion below is meaningful (a count WOULD have something to show).
  unitSlackMock.mockResolvedValue({
    unit: "u",
    repos: [
      {
        repo_path: "/p/tmai-core",
        repo_label: "tmai-core",
        primary: true,
        ores: [
          {
            ticket: "2026-06-11-120000",
            captured_at: "2026-06-11T12:00:00",
            body: "an ore",
            quoted_by: [],
          },
        ],
      },
    ],
  });
});

describe("AimPane — load + ledger", () => {
  it("parks with a placeholder + no fetch when no unit is focused", () => {
    renderPane(null);
    // Both faces park with their own placeholder (#809) — pin the AIM one.
    expect(screen.getByText(/プロジェクトを選択すると aim が表示されます/)).toBeTruthy();
    expect(aimsMock).not.toHaveBeenCalled();
    expect(unitSlackMock).not.toHaveBeenCalled();
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
    // excluded), claimed marks=3, confirmed marks=3. The pruned mark on
    // attention-per-artifact lands in NO bucket (#814) — counts unchanged.
    await waitFor(() => expect(ledger.textContent).toMatch(/2\s*drift/));
    expect(ledger.textContent).toMatch(/3\s*claimed/);
    expect(ledger.textContent).toMatch(/3\s*confirmed/);
    expect(ledger.textContent).not.toContain("pruned");
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
    await awaitLoaded();
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
    await awaitLoaded();
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
  it("shows the drift←ancestor pill and the interior is[] (mark-only, ref for confirmed/pruned)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    selectRow("attention-per-artifact");

    const insp = await screen.findByTestId("aim-inspector");
    expect(within(insp).getByTestId("aim-drift-pill").textContent).toContain(
      "drift ← 祖先 amplify-human-judgment",
    );
    const marks = within(insp).getAllByTestId("aim-mark");
    expect(marks.map((m) => m.dataset.kind)).toEqual(["confirmed", "claimed", "pruned"]);
    expect(marks[0].textContent).toContain("PR#490");
    expect(marks[1].textContent).toContain("ancestor moved");
    // pruned (#814): its own tag (neutral `p` class — not ochre `k`, not green
    // `c`) and the rejection reason riding `ref`, same layout as confirmed.
    expect(marks[2].textContent).toContain("⊘ pruned");
    expect(marks[2].textContent).toContain("[wrong premise — judgment lives in records]");
    const prunedTag = marks[2].querySelector(".ac-tg");
    expect(prunedTag?.classList.contains("p")).toBe(true);
    expect(prunedTag?.classList.contains("k")).toBe(false);
    expect(prunedTag?.classList.contains("c")).toBe(false);
  });

  it("interior dots are three-way: confirmed=c, claimed=k, pruned=p (#814)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    const dots = rowEl("attention-per-artifact").querySelectorAll(".ac-ism i");
    expect([...dots].map((d) => d.className)).toEqual(["c", "k", "p"]);
  });

  it("breadcrumb climbs to an ancestor", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
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
    await awaitLoaded();

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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
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
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe("true");

    unmount();
    renderPane();
    await awaitLoaded();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });
});

describe("AimPane — unit change", () => {
  it("resets per-unit view state (selection + forest) when the focused unit changes", async () => {
    aimsMock.mockImplementation((unit: string) =>
      Promise.resolve(
        unit === "a"
          ? responseStub([
              {
                label: "repo-a",
                primary: true,
                aims: [aimStub({ slug: "a-root", aim: "A root", is: [claimed("x")] })],
              },
            ])
          : responseStub([
              {
                label: "repo-b",
                primary: true,
                aims: [aimStub({ slug: "b-root", aim: "B root", is: [claimed("y")] })],
              },
            ]),
      ),
    );

    const { rerender } = render(
      <UIPrefsProvider>
        <AimPane unitName="a" />
      </UIPrefsProvider>,
    );
    await awaitLoaded();
    selectRow("a-root");
    await screen.findByTestId("aim-inspector");

    // Switch to unit "b" (a different forest) — same AimPane instance (no key
    // remount), so the in-component reset must clear the stale state.
    rerender(
      <UIPrefsProvider>
        <AimPane unitName="b" />
      </UIPrefsProvider>,
    );

    await waitFor(() => expect(rowEl("b-root")).toBeTruthy());
    // The previous unit's node is gone and its inspector selection cleared.
    expect(document.querySelector('[data-testid="aim-row"][data-slug="a-root"]')).toBeNull();
    expect(screen.queryByTestId("aim-inspector")).toBeNull();
  });
});

describe("AimPane — resignation inventory (#811)", () => {
  // A dedicated forest: a done node carrying both mark kinds, with a
  // multi-level subtree mixing open (one drifted), open-under-open, and a
  // done sibling — the buckets the inventory must (and must not) collect.
  const RESIG: AimWire[] = [
    aimStub({ slug: "resig-root", aim: "root bearing" }),
    aimStub({
      slug: "resig-done",
      aim: "the parked bearing",
      parent: "resig-root",
      state: "done",
      // The pruned mark belongs to NEITHER bucket (#814): adjudicated ≠
      // satisfied ≠ parked.
      is: [confirmed("landed", "PR#9"), claimed("tail debt"), pruned("dead-end route")],
    }),
    aimStub({
      slug: "resig-open-child",
      aim: "open child",
      parent: "resig-done",
      drift: driftFrom("resig-root"),
    }),
    aimStub({ slug: "resig-open-grand", aim: "open grandchild", parent: "resig-open-child" }),
    aimStub({ slug: "resig-done-child", aim: "done child", parent: "resig-done", state: "done" }),
  ];
  const resigResponse = () => responseStub([{ label: "tmai-core", primary: true, aims: RESIG }]);

  it("renders the inventory persistently on an already-done node (satisfied ⊥ parked ⊥ frontier)", async () => {
    aimsMock.mockResolvedValue(resigResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("resig-done");

    const insp = await screen.findByTestId("aim-inspector");
    const inv = within(insp).getByTestId("resignation-inventory");

    // 満足 — the node's own confirmed marks, ref shown. The pruned mark is
    // NOT here (adjudicated ≠ satisfied).
    const sat = within(inv).getAllByTestId("resig-satisfied");
    expect(sat.map((s) => s.textContent)).toEqual(["✓ confirmedlanded [PR#9]"]);

    // 諦め (a) — the node's own claimed marks, parked not settled. The pruned
    // mark is NOT here either (adjudicated ≠ parked, #814).
    const cl = within(inv).getAllByTestId("resig-claimed");
    expect(cl).toHaveLength(1);
    expect(cl[0].textContent).toContain("tail debt");
    expect(inv.textContent).not.toContain("dead-end route");

    // 諦め (b) — open descendants at any depth; the done child is NOT parked.
    const desc = within(inv).getAllByTestId("resig-open-desc");
    expect(desc.map((d) => d.dataset.slug)).toEqual(["resig-open-child", "resig-open-grand"]);

    // The drifted open descendant carries its drift badge (existing convention).
    expect(within(desc[0]).getByTestId("resig-drift-badge").textContent).toContain(
      "drift ← resig-root",
    );
    expect(within(desc[1]).queryByTestId("resig-drift-badge")).toBeNull();

    // The constant frontier line closes the enumerable buckets.
    expect(within(inv).getByTestId("resig-frontier").textContent).toBe(
      "この先は書かれていない残余 — 諦めはそこにも届く",
    );
  });

  it("renders NO inventory on an open node", async () => {
    aimsMock.mockResolvedValue(resigResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("resig-root");
    await screen.findByTestId("aim-inspector");
    expect(screen.queryByTestId("resignation-inventory")).toBeNull();
  });

  it("frontier line is constant and unconditional — empty buckets, done-drift tone untouched (pin #2)", async () => {
    // review-attention-budget: done+drift, no marks, no children — both
    // enumerable buckets are empty, the frontier still renders.
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    // Pin #2 first: the done-drift row tone keeps reading as done+⚠.
    const row = rowEl("review-attention-budget");
    expect(row.dataset.tone).toBe("done-drift");
    expect(within(row).getByTestId("aim-drift-badge")).toBeTruthy();

    selectRow("review-attention-budget");
    const insp = await screen.findByTestId("aim-inspector");
    const inv = within(insp).getByTestId("resignation-inventory");
    expect(within(inv).queryAllByTestId("resig-satisfied")).toHaveLength(0);
    expect(within(inv).queryAllByTestId("resig-claimed")).toHaveLength(0);
    expect(within(inv).queryAllByTestId("resig-open-desc")).toHaveLength(0);
    expect(within(inv).getByTestId("resig-frontier").textContent).toBe(
      "この先は書かれていない残余 — 諦めはそこにも届く",
    );
  });

  it("at done-set in the edit modal: inventory appears beside the state control, NEVER gates the act", async () => {
    aimsMock.mockResolvedValue(resigResponse());
    editAimMock.mockResolvedValue(
      aimStub({ slug: "resig-root", aim: "root bearing", state: "done" }),
    );
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("resig-root");
    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /編集/ }));

    const modal = await screen.findByTestId("aim-create-modal");
    // state is open → no inventory yet.
    expect(within(modal).queryByTestId("resignation-inventory")).toBeNull();

    // Flip TO done → the inventory appears inline (what this done will park):
    // resig-root's whole open subtree is gone except… resig-done is done, so
    // parked = the open descendants under it too (subtree at any depth).
    fireEvent.change(within(modal).getByLabelText("state"), { target: { value: "done" } });
    const inv = within(modal).getByTestId("resignation-inventory");
    expect(
      within(inv)
        .getAllByTestId("resig-open-desc")
        .map((d) => d.dataset.slug),
    ).toEqual(["resig-open-child", "resig-open-grand"]);
    expect(within(inv).getByTestId("resig-frontier")).toBeTruthy();

    // NOT a gate: submit stays enabled, no confirm step — one click commits.
    const save = within(modal).getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(editAimMock).toHaveBeenCalledWith("u", "resig-root", {
        aim: "root bearing",
        parent: null,
        state: "done",
      }),
    );
  });

  it("flipping the state select back to open removes the inventory (reversible)", async () => {
    aimsMock.mockResolvedValue(resigResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("resig-root");
    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /編集/ }));

    const modal = await screen.findByTestId("aim-create-modal");
    fireEvent.change(within(modal).getByLabelText("state"), { target: { value: "done" } });
    expect(within(modal).getByTestId("resignation-inventory")).toBeTruthy();
    fireEvent.change(within(modal).getByLabelText("state"), { target: { value: "open" } });
    expect(within(modal).queryByTestId("resignation-inventory")).toBeNull();
  });
});

describe("AimPane — [AIM | SLACK] faces (#809)", () => {
  function faceEl(face: "aim" | "slack"): HTMLElement {
    return screen.getByTestId(`aim-face-${face}`);
  }

  it("defaults to AIM; switching shows/hides the faces without unmounting AIM", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    expect(faceEl("aim").hidden).toBe(false);
    expect(faceEl("slack").hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "SLACK" }));
    expect(faceEl("aim").hidden).toBe(true);
    expect(faceEl("slack").hidden).toBe(false);
    // AIM content untouched while SLACK is active — hidden, NOT unmounted:
    // the worklist rows are still there, state intact.
    expect(within(faceEl("aim")).getAllByTestId("aim-row").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(within(faceEl("slack")).getAllByTestId("slack-ore").length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByRole("button", { name: "AIM" }));
    expect(faceEl("aim").hidden).toBe(false);
    expect(faceEl("slack").hidden).toBe(true);
    // A tab round-trip re-fetches NOTHING — both faces stayed mounted.
    expect(aimsMock).toHaveBeenCalledTimes(1);
    expect(unitSlackMock).toHaveBeenCalledTimes(1);
  });

  it("AIM face state (selection) survives a SLACK detour", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    selectRow("amplify-human-judgment");
    await screen.findByTestId("aim-inspector");

    fireEvent.click(screen.getByRole("button", { name: "SLACK" }));
    fireEvent.click(screen.getByRole("button", { name: "AIM" }));
    // The inspector selection is exactly where it was left.
    expect(screen.getByTestId("aim-inspector")).toBeTruthy();
  });

  it("tab labels carry NO badge / count — terrain, not a queue", async () => {
    // The slack mock (beforeEach) returns 1 ore, so a counter WOULD have
    // something to show; assert it never does.
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    await waitFor(() =>
      expect(within(faceEl("slack")).getAllByTestId("slack-ore").length).toBeGreaterThan(0),
    );

    const tabs = screen.getByTestId("aim-face-tabs");
    expect(tabs.textContent).toBe("AIMSLACK");
    const slackTab = screen.getByRole("button", { name: "SLACK" });
    expect(slackTab.textContent).toBe("SLACK");
    expect(slackTab.querySelector("*")).toBeNull();
    expect(tabs.textContent).not.toMatch(/\d/);
  });
});
