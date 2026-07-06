// @vitest-environment jsdom
//
// AimPane — the aim-console's Aim (left) pane (S2). A faithful reproduction of
// the destination mock's `.aim` section + create-aim modal in the dev-tool
// tokens, wired to the REUSED Stage B logic layer (`r-panel/aim-tree.ts`,
// `useUnitAims`, `api.createAim` / `api.editAim`). This test covers the
// presentation port against the real wire shape: the ledger, the Frontier owed
// worklist (drift-first, breadcrumbed, done-drift distinct — pin #2), the Tree
// navigator (grouping + rollups + collapse), the overview ruler reveal, the
// inspector (drift pill), the search filter,
// and the create / edit modal (kebab validation + refetch — pin #3).
//
// Mirrors RAimsSection.test.tsx's fixtures (same forest) so the two surfaces
// stay behaviourally comparable; only the markup/queries differ.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AimsResponse, AimWire } from "@/lib/api";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimWorkingDeltaWire } from "@/types/generated/AimWorkingDeltaWire";

const aimsMock = vi.fn();
const createAimMock = vi.fn();
const editAimMock = vi.fn();
// Clipboard mock for the copy-reference buttons (jsdom has no navigator.clipboard).
const writeText = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);

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
const wd = (overrides: Partial<AimWorkingDeltaWire> = {}): AimWorkingDeltaWire => ({
  uncommitted: false,
  uncommitted_anchor_change: false,
  untracked: false,
  ...overrides,
});
// A body with a `# PROCESS` section carrying todo/done units — the owed-signal
// source (the panel reads progress off the body's PROCESS checklist).
const procBody = ({ todo = 0, done = 0 }: { todo?: number; done?: number } = {}): string => {
  const items = [
    ...Array.from({ length: todo }, (_, i) => `- [todo] todo ${i}`),
    ...Array.from({ length: done }, (_, i) => `- [done] done ${i}`),
  ];
  return items.length === 0 ? "" : `# PROCESS\n${items.join("\n")}`;
};

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
    ...overrides,
  };
}

// Two repos (same shape as RAimsSection's fixture):
//   tmai-core (primary)
//     amplify-human-judgment (root, open, 1 todo)                → owed (todo)
//       attention-per-artifact (open, drift←amplify, 1 todo+done) → owed (drift)
//         attention-backend (done, 1 done)                        → plain done
//     aim-system (root, open, 1 done)                            → calm
//       aim-honesty (dead)                                        → abandoned
//       review-attention-budget (done, drift←aim-system)          → PIN #2
//   tmai
//     inverted-ui (root, open, 1 todo)                           → owed (todo)
const CORE: AimWire[] = [
  aimStub({
    slug: "amplify-human-judgment",
    aim: "amplify judgment",
    body: procBody({ todo: 1 }),
  }),
  aimStub({
    slug: "attention-per-artifact",
    aim: "per-artifact attention",
    parent: "amplify-human-judgment",
    drift: driftFrom("amplify-human-judgment"),
    body: procBody({ todo: 1, done: 1 }),
  }),
  aimStub({
    slug: "attention-backend",
    aim: "backend compute",
    parent: "attention-per-artifact",
    state: "done",
    body: procBody({ done: 1 }),
  }),
  aimStub({
    slug: "aim-system",
    aim: "records as structure",
    body: procBody({ done: 1 }),
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
  aimStub({
    slug: "inverted-ui",
    aim: "root to conversation",
    body: procBody({ todo: 1 }),
  }),
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
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("AimPane — load + ledger", () => {
  it("parks with a placeholder + no fetch when no unit is focused", () => {
    renderPane(null);
    expect(screen.getByText(/プロジェクトを選択すると aim が表示されます/)).toBeTruthy();
    expect(aimsMock).not.toHaveBeenCalled();
  });

  it("surfaces a fetch error", async () => {
    aimsMock.mockRejectedValue(new Error("boom"));
    renderPane();
    await waitFor(() => expect(screen.getByText(/読み込みに失敗: boom/)).toBeTruthy());
  });

  it("ledger counts drift / todo / done off the forest", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    const ledger = await screen.findByTestId("aim-ledger");
    // drift=2 (attention-per-artifact open + review-attention-budget done; dead
    // excluded), todo units=3 (amplify + attention-per-artifact + inverted-ui),
    // done units=3 (attention-per-artifact + attention-backend + aim-system).
    await waitFor(() => expect(ledger.textContent).toMatch(/2\s*drift/));
    expect(ledger.textContent).toMatch(/3\s*todo/);
    expect(ledger.textContent).toMatch(/3\s*done/);
  });
});

describe("AimPane — Frontier mode (owed worklist)", () => {
  it("defaults to Frontier, lists owed drift-first, calm absent, done-drift distinct", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await waitFor(() => expect(rowEl("attention-per-artifact").dataset.tone).toBe("drift"));
    expect(rowEl("amplify-human-judgment").dataset.tone).toBe("todo");
    // A calm (done-only) node is NOT in the worklist.
    expect(document.querySelector('[data-testid="aim-row"][data-slug="aim-system"]')).toBeNull();
    // Owed in the non-primary repo too.
    expect(rowEl("inverted-ui").dataset.tone).toBe("todo");

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
          aims: [aimStub({ slug: "calm", body: procBody({ done: 1 }) })],
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
  it("shows the drift←ancestor pill in the inspector", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    selectRow("attention-per-artifact");

    const insp = await screen.findByTestId("aim-inspector");
    expect(within(insp).getByTestId("aim-drift-pill").textContent).toContain(
      "drift ← 祖先 amplify-human-judgment",
    );
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

describe("AimPane — copy reference (aim: operator-cites-aim)", () => {
  it("the slug-head button copies the bare `[[slug]]` pointer", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    // Tree mode so the calm (non-owed) aim-system is reachable.
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("aim-system");

    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByTestId("aim-copy-slug"));
    expect(writeText).toHaveBeenCalledWith("[[aim-system]]");
  });

  it("a PROCESS todo button copies `[[slug]] <item text>`", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPane();
    await awaitLoaded();
    // amplify-human-judgment is owed (todo) → selectable in the default Frontier
    // view; its body PROCESS carries one `- [todo] todo 0` item.
    selectRow("amplify-human-judgment");

    const insp = await screen.findByTestId("aim-inspector");
    const item = within(insp).getAllByTestId("aim-means-item")[0];
    fireEvent.click(within(item).getByTestId("aim-copy-ref"));
    expect(writeText).toHaveBeenCalledWith("[[amplify-human-judgment]] todo 0");
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
                aims: [aimStub({ slug: "a-root", aim: "A root", body: procBody({ todo: 1 }) })],
              },
            ])
          : responseStub([
              {
                label: "repo-b",
                primary: true,
                aims: [aimStub({ slug: "b-root", aim: "B root", body: procBody({ todo: 1 }) })],
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
  // A dedicated forest: a done node whose PROCESS carries a 実装済 + a 未実装
  // (plus an unmarked item), with a multi-level subtree mixing open (one
  // drifted), open-under-open, and a done sibling — the buckets the inventory
  // must (and must not) collect.
  const RESIG: AimWire[] = [
    aimStub({ slug: "resig-root", aim: "root bearing" }),
    aimStub({
      slug: "resig-done",
      aim: "the parked bearing",
      parent: "resig-root",
      state: "done",
      // An unmarked PROCESS item belongs to NEITHER bucket: no status, no
      // judgment (the done/todo analog of the old "adjudicated" drop).
      body: "# PROCESS\n- [done] landed\n- [todo] tail debt\n- dead-end route\n",
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

    // 満足 — the node's own 実装済 PROCESS items. The unmarked item is NOT
    // here (no status ≠ satisfied).
    const sat = within(inv).getAllByTestId("resig-satisfied");
    expect(sat.map((s) => s.textContent)).toEqual(["✓ 実装済landed"]);

    // 諦め (a) — the node's own 未実装 PROCESS items, parked not settled. The
    // unmarked item is NOT here either (no status ≠ parked).
    const cl = within(inv).getAllByTestId("resig-parked-todo");
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
    // review-attention-budget: done+drift, no PROCESS, no children — both
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
    expect(within(inv).queryAllByTestId("resig-parked-todo")).toHaveLength(0);
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

describe("AimPane — working_delta presence facts (#817)", () => {
  // A dedicated forest under one auto-expanded root: the three presence
  // shapes, a both-drifted-and-dirty node, and a clean sibling.
  const WDF: AimWire[] = [
    aimStub({ slug: "wd-root", aim: "root bearing" }),
    aimStub({
      slug: "wd-plain",
      aim: "dirty body",
      parent: "wd-root",
      working_delta: wd({ uncommitted: true }),
    }),
    aimStub({
      slug: "wd-anchor",
      aim: "dirty anchor",
      parent: "wd-root",
      working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
    }),
    aimStub({
      slug: "wd-new",
      aim: "untracked node",
      parent: "wd-root",
      working_delta: wd({ untracked: true }),
    }),
    aimStub({
      slug: "wd-drift",
      aim: "drifted AND dirty",
      parent: "wd-root",
      drift: driftFrom("wd-root"),
      working_delta: wd({ uncommitted: true }),
    }),
    aimStub({ slug: "wd-clean", aim: "clean sibling", parent: "wd-root" }),
  ];
  const wdResponse = () => responseStub([{ label: "tmai-core", primary: true, aims: WDF }]);

  function wdBadge(slug: string): HTMLElement | null {
    return rowEl(slug).querySelector('[data-testid="aim-wd-badge"]');
  }

  it("each presence shape gets its own △ class; a clean row gets none", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const plain = wdBadge("wd-plain");
    expect(plain?.textContent).toBe("△");
    expect(plain?.dataset.wd).toBe("uncommitted");
    expect(plain?.classList.contains("ac-wd")).toBe(true);
    expect(plain?.classList.contains("an")).toBe(false);
    expect(plain?.classList.contains("nw")).toBe(false);

    const anchor = wdBadge("wd-anchor");
    expect(anchor?.dataset.wd).toBe("uncommitted-anchor");
    expect(anchor?.classList.contains("an")).toBe(true);

    const fresh = wdBadge("wd-new");
    expect(fresh?.dataset.wd).toBe("untracked");
    expect(fresh?.classList.contains("nw")).toBe(true);

    expect(wdBadge("wd-clean")).toBeNull();
  });

  it("drift ⚠ and △ coexist on one row — two distinct glyphs, never merged", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));

    const row = rowEl("wd-drift");
    // The tone (and its ⚠ glyph) stays pure drift — presence never restyles it.
    expect(row.dataset.tone).toBe("drift");
    expect(row.querySelector(".ac-gly.dr")?.textContent).toBe("⚠");
    const badge = within(row).getByTestId("aim-wd-badge");
    expect(badge.textContent).toBe("△");
    expect(badge.classList.contains("ac-wd")).toBe(true);
    expect(badge.classList.contains("dr")).toBe(false);
  });

  it("inspector states the presence fact line in the compose register", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("wd-anchor");

    const insp = await screen.findByTestId("aim-inspector");
    const pill = within(insp).getByTestId("aim-wd-pill");
    expect(pill.dataset.wd).toBe("uncommitted-anchor");
    expect(pill.textContent).toContain("uncommitted edits including the `aim:` anchor line");
    expect(pill.textContent).toContain("the drift verdict is HEAD-based and does not see this yet");
    // Presence is NOT drift — no drift pill on a merely-dirty node.
    expect(within(insp).queryByTestId("aim-drift-pill")).toBeNull();
  });

  it("no fact line on a clean node", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPane();
    await awaitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow("wd-clean");
    const insp = await screen.findByTestId("aim-inspector");
    expect(within(insp).queryByTestId("aim-wd-pill")).toBeNull();
  });

  it("presence is NEVER owed: not in the Frontier worklist, not in the ledger counts", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPane();
    await awaitLoaded();

    // Frontier (default mode): only the genuinely drifted node is owed; the
    // three presence-only nodes are absent.
    await waitFor(() => expect(rowEl("wd-drift")).toBeTruthy());
    for (const slug of ["wd-plain", "wd-anchor", "wd-new", "wd-clean"]) {
      expect(document.querySelector(`[data-testid="aim-row"][data-slug="${slug}"]`)).toBeNull();
    }

    // Ledger: drift counts ONLY wd-drift's committed-layer verdict; presence
    // adds nothing to any bucket.
    const ledger = screen.getByTestId("aim-ledger");
    expect(ledger.textContent).toMatch(/1\s*drift/);
    expect(ledger.textContent).toMatch(/0\s*todo/);
    expect(ledger.textContent).toMatch(/0\s*done/);
  });
});

describe("AimPane — cross-edge inspector (aim: aim-cross-edge-link)", () => {
  // A forest whose bodies carry `[[slug]]` DAG links, spanning both repos:
  //   tmai-core:  xe-a  (root) → body links [[xe-b]] + [[xe-ghost]] (dangling)
  //               xe-b  (child of xe-a) — no links; referenced by xe-a AND xe-c
  //               xe-iso (root) — no links, unreferenced (isolated)
  //   tmai:       xe-c  (root) → body links [[xe-b]] (a CROSS-REPO edge)
  const XCORE: AimWire[] = [
    aimStub({
      slug: "xe-a",
      aim: "the a bearing",
      body: "# DAG\n- 依存: [[xe-b]] — leans on b\n- 関連: [[xe-ghost]] — a missing target",
    }),
    aimStub({ slug: "xe-b", aim: "the b bearing", parent: "xe-a" }),
    aimStub({ slug: "xe-iso", aim: "the isolated bearing" }),
  ];
  const XUI: AimWire[] = [
    aimStub({ slug: "xe-c", aim: "the c bearing", body: "# IS\nbuilds on [[xe-b]] here." }),
  ];
  const xResponse = () =>
    responseStub([
      { label: "tmai-core", primary: true, aims: XCORE },
      { label: "tmai", primary: false, aims: XUI },
    ]);

  // The cross-edge section, scoped to the open inspector.
  function xedge(): HTMLElement {
    const insp = screen.getByTestId("aim-inspector");
    return within(insp).getByTestId("aim-cross-edges");
  }
  const slugsIn = (dir: "out" | "in"): string[] =>
    Array.from(xedge().querySelectorAll(`[data-testid="aim-cross-${dir}"] [data-slug]`)).map(
      (el) => (el as HTMLElement).dataset.slug ?? "",
    );

  async function selectInTree(slug: string) {
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow(slug);
    await screen.findByTestId("aim-inspector");
  }

  it("outbound lists the body's `[[slug]]` links; a dangling target shows dim + non-navigable", async () => {
    aimsMock.mockResolvedValue(xResponse());
    renderPane();
    await awaitLoaded();
    await selectInTree("xe-a");

    const out = within(xedge()).getByTestId("aim-cross-out");
    expect(out.dataset.count).toBe("2");
    expect(slugsIn("out")).toEqual(["xe-b", "xe-ghost"]);

    // The resolved target is a navigable button carrying the target's ought as title.
    const bChip = out.querySelector('[data-slug="xe-b"]') as HTMLElement;
    expect(bChip.tagName).toBe("BUTTON");
    expect(bChip.getAttribute("title")).toBe("the b bearing");
    // The dangling target is a non-button span, marked, surfaced not dropped.
    const ghost = out.querySelector('[data-slug="xe-ghost"]') as HTMLElement;
    expect(ghost.tagName).toBe("SPAN");
    expect(ghost.dataset.dangling).toBe("true");

    // xe-a is referenced by nobody → inbound is an explicit "none".
    const inb = within(xedge()).getByTestId("aim-cross-in");
    expect(inb.dataset.count).toBe("0");
    expect(inb.textContent).toContain("なし");
  });

  it("inbound lists who references the node — across the repo boundary", async () => {
    aimsMock.mockResolvedValue(xResponse());
    renderPane();
    await awaitLoaded();
    await selectInTree("xe-b");

    // xe-b links to nothing…
    expect(within(xedge()).getByTestId("aim-cross-out").dataset.count).toBe("0");
    // …but is referenced by xe-a (same repo) AND xe-c (the other repo).
    expect(within(xedge()).getByTestId("aim-cross-in").dataset.count).toBe("2");
    expect(slugsIn("in")).toEqual(["xe-a", "xe-c"]);
  });

  it("clicking an inbound chip navigates the inspector to that referrer", async () => {
    aimsMock.mockResolvedValue(xResponse());
    renderPane();
    await awaitLoaded();
    await selectInTree("xe-b");

    const cChip = xedge().querySelector(
      '[data-testid="aim-cross-in"] [data-slug="xe-c"]',
    ) as HTMLElement;
    fireEvent.click(cChip);
    await waitFor(() =>
      expect(screen.getByTestId("aim-inspector").textContent).toContain("the c bearing"),
    );
  });

  it("renders no cross-edge section for an isolated node (no edge either way)", async () => {
    aimsMock.mockResolvedValue(xResponse());
    renderPane();
    await awaitLoaded();
    await selectInTree("xe-iso");
    expect(within(screen.getByTestId("aim-inspector")).queryByTestId("aim-cross-edges")).toBeNull();
  });
});
