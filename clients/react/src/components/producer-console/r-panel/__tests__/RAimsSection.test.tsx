// @vitest-environment jsdom
//
// RAimsSection — the destination Aim panel (Stage B convergence, #791). The
// section is a THIN R-panel entry (summary + owed badge + ⤢ open); the full
// panel lives in a maximized, portalled overlay opened from it. Covers the
// wire-backed entry states, and inside the panel: the Frontier owed worklist
// (drift-first, breadcrumbed, calm-empty), the Tree per-repo navigator
// (grouping + rollups + collapse), the ledger counts, the inspector (drift
// pill), the overview ruler reveal, search, and the carried-over create / edit
// write flows. Pins exercised: #2 done+drift distinct (not suppressed), #3
// drift mirrors the engine (edit → refetch, no client cascade).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AimsResponse, AimWire } from "@/lib/api";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimWorkingDeltaWire } from "@/types/generated/AimWorkingDeltaWire";

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

import { RAimsSection } from "../RAimsSection";

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

// Two repos:
//   tmai-core (primary)
//     amplify-human-judgment (root, open, 1 todo)             → owed (todo)
//       attention-per-artifact (open, drift←amplify,
//                               1 todo+done)                   → owed (drift)
//         attention-backend (done, 1 done)                    → plain done
//     aim-system (root, open, 1 done)                         → calm
//       aim-honesty (dead)                                    → abandoned
//       review-attention-budget (done, drift←aim-system)      → PIN #2 done+drift
//   tmai
//     inverted-ui (root, open, 1 todo)                        → owed (todo)
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
    composed_at: "2026-06-07T00:00:00Z",
    repos: repos.map((r) => ({
      repo_label: r.label,
      repo_root: `/p/${r.label}`,
      primary: r.primary,
      repo_head: null,
      aims: r.aims,
    })),
  };
}

function renderPanel(unitName: string | null = "u") {
  return render(
    <UIPrefsProvider>
      <RAimsSection unitName={unitName} expanded={true} onToggle={vi.fn()} />
    </UIPrefsProvider>,
  );
}

async function openPanel() {
  const openBtn = await screen.findByRole("button", { name: /Open aim panel/ });
  fireEvent.click(openBtn);
  return screen.findByRole("dialog", { name: "Aim panel" });
}

// The row element for a slug (the panel is portalled to document.body).
function rowEl(slug: string): HTMLElement {
  const el = document.querySelector(`[data-testid="aim-row"][data-slug="${slug}"]`);
  if (!el) throw new Error(`no row for ${slug}`);
  return el as HTMLElement;
}
function selectRow(slug: string) {
  // The select button is the one carrying aria-pressed (toggle / add buttons
  // do not), so this is unambiguous within a row.
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

describe("RAimsSection — thin entry", () => {
  it("shows a compact aim/repo summary + an owed badge, not the panel", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();

    await waitFor(() => expect(screen.getByText(/7 aims/)).toBeTruthy());
    expect(screen.getByText(/7 aims/).textContent).toContain("2 repo");
    // Owed badge surfaces drift (2) without opening.
    expect(screen.getByText(/2 drift/)).toBeTruthy();
    // The panel is NOT mounted until opened.
    expect(screen.queryByRole("dialog", { name: "Aim panel" })).toBeNull();
  });

  it("header count is the plain total (no severity styling)", async () => {
    aimsMock.mockResolvedValue(responseStub());
    const { container } = render(
      <UIPrefsProvider>
        <RAimsSection unitName="u" expanded={false} onToggle={vi.fn()} />
      </UIPrefsProvider>,
    );
    await waitFor(() => expect(screen.getByText("7")).toBeTruthy());
    // The Section header count carries no appraisal accent.
    const header = container.querySelector('[data-testid="r-section-aims"] button');
    expect(header?.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("shows a loading placeholder during the initial fetch", () => {
    aimsMock.mockReturnValue(new Promise<AimsResponse>(() => {}));
    renderPanel();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("stays actionable at zero aims (the first node can be authored)", async () => {
    aimsMock.mockResolvedValue(responseStub([{ label: "tmai-core", primary: true, aims: [] }]));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/0 aims/)).toBeTruthy());
    await openPanel();
    expect(screen.getByRole("button", { name: "New aim" })).toBeTruthy();
  });

  it("surfaces a fetch error", async () => {
    aimsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Failed to load aims: boom/)).toBeTruthy());
  });

  it("parks with a placeholder when no project is selected (no fetch)", () => {
    renderPanel(null);
    expect(screen.getByText(/Pick a project to see aims\./)).toBeTruthy();
    expect(aimsMock).not.toHaveBeenCalled();
  });
});

describe("RAimsSection — panel shell", () => {
  it("opens on ⤢, dismisses via ✕ and via Esc", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: /Close aim panel/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aim panel" })).toBeNull());

    await openPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aim panel" })).toBeNull());
  });

  it("ledger counts drift / todo / done off the forest", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    const ledger = screen.getByTestId("aim-ledger");
    // drift=2 (attention-per-artifact open + review-attention-budget done; dead
    // excluded), todo units=3 (amplify + attention-per-artifact + inverted-ui),
    // done units=3 (attention-per-artifact + attention-backend + aim-system).
    expect(ledger.textContent).toMatch(/2\s*drift/);
    expect(ledger.textContent).toMatch(/3\s*todo/);
    expect(ledger.textContent).toMatch(/3\s*done/);
  });
});

describe("RAimsSection — Frontier mode (owed worklist)", () => {
  it("defaults to Frontier and lists owed nodes drift-first, calm nodes absent", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();

    // owed in core: drift (attention-per-artifact) then todo (amplify…).
    expect(rowEl("attention-per-artifact").dataset.tone).toBe("drift");
    expect(rowEl("amplify-human-judgment").dataset.tone).toBe("todo");
    // A calm (done-only) node is NOT in the worklist.
    expect(document.querySelector('[data-testid="aim-row"][data-slug="aim-system"]')).toBeNull();
    // owed in the non-primary repo too.
    expect(rowEl("inverted-ui").dataset.tone).toBe("todo");
  });

  it("breadcrumbs each owed row with its ought-ancestry", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    // attention-per-artifact sits under amplify-human-judgment.
    expect(rowEl("attention-per-artifact").textContent).toContain("amplify-human-judgment");
  });

  it("PIN #2 — a done+drift node is surfaced DISTINCTLY, not suppressed, not folded into owed", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();

    // It renders (surfaced) with its own done-drift tone…
    const r = rowEl("review-attention-budget");
    expect(r.dataset.tone).toBe("done-drift");
    // …carries the distinct drift badge (a done ✓ would otherwise hide it)…
    expect(within(r).getByTestId("aim-drift-badge")).toBeTruthy();
    // …and lives under the dedicated "done · drifted" cluster, not the worklist.
    expect(screen.getByText(/done · drifted/)).toBeTruthy();
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
    renderPanel();
    await openPanel();
    expect(screen.getByText(/the forest is calm/)).toBeTruthy();
  });
});

describe("RAimsSection — Tree mode (per-repo navigator + rollups)", () => {
  async function openTree() {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  }

  it("groups by repo (primary highlighted) and un-flattens the forest", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openTree();
    const heads = screen.getAllByTestId("aim-repo-head");
    expect(heads.map((h) => h.dataset.repo)).toEqual(["tmai-core", "tmai"]);
    // Primary repo head carries the info accent (inset shadow var).
    expect(heads[0].className).toContain("--color-info");
  });

  it("collapsing a branch reveals a rollup badge with the owed breakdown", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openTree();
    // amplify is a root → open by default; collapse it.
    const toggle = rowEl("amplify-human-judgment").querySelector('button[aria-label^="Collapse"]');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as Element);
    // Its child (attention-per-artifact) is now hidden…
    expect(
      document.querySelector('[data-testid="aim-row"][data-slug="attention-per-artifact"]'),
    ).toBeNull();
    // …and the rollup shows the subtree's drift count (⚠1: attention-per-artifact).
    const rollup = within(rowEl("amplify-human-judgment")).getByTestId("aim-rollup");
    expect(rollup.textContent).toContain("⚠1");
  });
});

describe("RAimsSection — inspector", () => {
  it("shows the drift←ancestor pill in the inspector", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    selectRow("attention-per-artifact");

    const insp = await screen.findByTestId("aim-inspector");
    // drift pill names the stale-from ancestor.
    expect(within(insp).getByTestId("aim-drift-pill").textContent).toContain(
      "drift ← amplify-human-judgment",
    );
  });

  it("breadcrumb in the inspector lets you climb to an ancestor", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    selectRow("attention-per-artifact");

    const insp = await screen.findByTestId("aim-inspector");
    // The ancestor slug is a clickable crumb; clicking re-selects it.
    fireEvent.click(within(insp).getByRole("button", { name: "amplify-human-judgment" }));
    await waitFor(() => {
      expect(screen.getByTestId("aim-inspector").textContent).toContain("amplify judgment");
    });
  });
});

describe("RAimsSection — overview ruler", () => {
  it("clicking a lit tick reveals the node in Tree mode and selects it", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();

    const tick = document.querySelector(
      '[data-testid="ruler-tick"][data-slug="attention-per-artifact"]',
    );
    expect(tick?.getAttribute("data-owed")).toBe("drift");
    fireEvent.click(tick as Element);

    // Reveal switches to Tree (the Tree toggle is now pressed) and selects.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
    expect(screen.getByTestId("aim-inspector").textContent).toContain("per-artifact attention");
  });
});

describe("RAimsSection — search", () => {
  it("filters the owed worklist by slug / ought", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();

    fireEvent.change(screen.getByLabelText("Filter aims"), { target: { value: "per-artifact" } });
    expect(rowEl("attention-per-artifact")).toBeTruthy();
    expect(
      document.querySelector('[data-testid="aim-row"][data-slug="amplify-human-judgment"]'),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter aims"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText(/No owed aim matches/)).toBeTruthy();
  });
});

describe("RAimsSection — create (carried Stage 2-B, integrated)", () => {
  it("creates from the + aim form and reflects it after the refetch", async () => {
    const created = aimStub({ slug: "new-node", aim: "the new bearing" });
    aimsMock.mockResolvedValueOnce(responseStub());
    aimsMock.mockResolvedValue(
      responseStub([{ label: "tmai-core", primary: true, aims: [...CORE, created] }]),
    );
    createAimMock.mockResolvedValue(created);

    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "the new bearing" } });
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "new-node" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "new-node",
        aim: "the new bearing",
        parent: null,
      }),
    );
    // The refetch + reveal surfaces the node (in a row, and the inspector).
    await waitFor(() => expect(screen.getAllByText("the new bearing").length).toBeGreaterThan(0));
  });

  it("offers add-child from the inspector, presetting the parent", async () => {
    aimsMock.mockResolvedValue(responseStub());
    createAimMock.mockResolvedValue(
      aimStub({ slug: "child", aim: "c", parent: "amplify-human-judgment" }),
    );
    renderPanel();
    await openPanel();
    selectRow("amplify-human-judgment");
    fireEvent.click(await screen.findByRole("button", { name: /Add child aim/ }));

    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "c" } });
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "child" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "child",
        aim: "c",
        parent: "amplify-human-judgment",
      }),
    );
  });

  it("blocks a client-invalid (dated) slug and a duplicate without calling the API", async () => {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));

    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "2026-01-02-x" } });
    expect(screen.getByText(/NON-dated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "aim-system" } });
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(createAimMock).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection inline", async () => {
    aimsMock.mockResolvedValue(responseStub());
    createAimMock.mockRejectedValue(new Error("aim 'racy' already exists"));
    renderPanel();
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "New aim" }));
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "racy" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
  });
});

describe("RAimsSection — edit (pin #3: drift mirrors the engine on refetch)", () => {
  async function selectAndEdit(slug: string) {
    aimsMock.mockResolvedValue(responseStub());
    renderPanel();
    await openPanel();
    // Edit from Tree mode so calm (non-owed) nodes like aim-system are reachable
    // (Frontier only lists owed rows).
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    selectRow(slug);
    const insp = await screen.findByTestId("aim-inspector");
    fireEvent.click(within(insp).getByRole("button", { name: /Edit frontmatter/ }));
    return insp;
  }

  it("saves an edited aim / parent / state and REFETCHES (no client-side cascade)", async () => {
    editAimMock.mockResolvedValue(aimStub({ slug: "aim-system", aim: "edited bearing" }));
    const insp = await selectAndEdit("aim-system");

    fireEvent.change(within(insp).getByLabelText("aim"), { target: { value: "edited bearing" } });
    fireEvent.change(within(insp).getByLabelText("state"), { target: { value: "done" } });
    fireEvent.click(within(insp).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(editAimMock).toHaveBeenCalledWith("u", "aim-system", {
        aim: "edited bearing",
        parent: null,
        state: "done",
      }),
    );
    // Pin #3: the save triggers a refetch — the panel renders whatever drift the
    // wire then reports; it does NOT fake a transitive cascade client-side.
    await waitFor(() => expect(aimsMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("cancel leaves the node untouched (no API call)", async () => {
    const insp = await selectAndEdit("aim-system");
    fireEvent.change(within(insp).getByLabelText("aim"), { target: { value: "scrapped" } });
    fireEvent.click(within(insp).getByRole("button", { name: "Cancel" }));
    expect(within(insp).getByText(/Edit frontmatter/)).toBeTruthy();
    expect(editAimMock).not.toHaveBeenCalled();
  });

  it("excludes the node + its descendants from the parent options (no cycles)", async () => {
    const insp = await selectAndEdit("amplify-human-judgment");
    const parentSelect = within(insp).getByLabelText("parent") as HTMLSelectElement;
    const options = Array.from(parentSelect.options).map((o) => o.value);
    expect(options).not.toContain("amplify-human-judgment");
    expect(options).not.toContain("attention-per-artifact"); // descendant
    expect(options).not.toContain("attention-backend"); // deeper descendant
    expect(options).toContain("aim-system"); // outside the subtree → allowed
  });
});

describe("RAimsSection — working_delta presence facts (#817)", () => {
  // The three presence shapes + a both-drifted-and-dirty node + a clean
  // sibling, under one auto-expanded root (mirrors AimPane.test's forest).
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

  async function openTree() {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  }
  function wdBadge(slug: string): HTMLElement | null {
    return rowEl(slug).querySelector('[data-testid="aim-wd-badge"]');
  }

  it("rows carry the △ glyph per presence kind (info accent for the anchor edit, dotted for untracked); clean rows none", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPanel();
    await openTree();

    const plain = wdBadge("wd-plain");
    expect(plain?.textContent).toBe("△");
    expect(plain?.dataset.wd).toBe("uncommitted");
    expect(plain?.className).not.toContain("text-info");
    expect(plain?.className).not.toContain("text-warning");

    const anchor = wdBadge("wd-anchor");
    expect(anchor?.dataset.wd).toBe("uncommitted-anchor");
    expect(anchor?.className).toContain("text-info");

    const fresh = wdBadge("wd-new");
    expect(fresh?.dataset.wd).toBe("untracked");
    expect(fresh?.className).toContain("border-dotted");

    expect(wdBadge("wd-clean")).toBeNull();
  });

  it("drift and presence coexist on one row, each with its own glyph; tone stays pure drift", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPanel();
    await openTree();

    const row = rowEl("wd-drift");
    expect(row.dataset.tone).toBe("drift");
    expect(row.textContent).toContain("⚠"); // the drift tone glyph
    const badge = within(row).getByTestId("aim-wd-badge");
    expect(badge.textContent).toBe("△");
    expect(badge.className).not.toContain("text-warning"); // never restyled as drift
  });

  it("inspector adds the presence fact pill beside (not inside) the drift pill", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPanel();
    await openTree();
    selectRow("wd-drift");

    const insp = await screen.findByTestId("aim-inspector");
    // Both facts, separately stated.
    expect(within(insp).getByTestId("aim-drift-pill").textContent).toContain("drift ← wd-root");
    const pill = within(insp).getByTestId("aim-wd-pill");
    expect(pill.dataset.wd).toBe("uncommitted");
    expect(pill.textContent).toContain("uncommitted edits (anchor line untouched)");
    expect(pill.textContent).toContain("the drift verdict is HEAD-based and does not see this yet");

    selectRow("wd-clean");
    await waitFor(() => expect(screen.queryByTestId("aim-wd-pill")).toBeNull());
  });

  it("presence is NEVER owed: Frontier and the ledger ignore it", async () => {
    aimsMock.mockResolvedValue(wdResponse());
    renderPanel();
    await openPanel();

    // Frontier (default): only the genuinely drifted node.
    await waitFor(() => expect(rowEl("wd-drift")).toBeTruthy());
    for (const slug of ["wd-plain", "wd-anchor", "wd-new", "wd-clean"]) {
      expect(document.querySelector(`[data-testid="aim-row"][data-slug="${slug}"]`)).toBeNull();
    }
    const ledger = screen.getByTestId("aim-ledger");
    expect(ledger.textContent).toMatch(/1\s*drift/);
    expect(ledger.textContent).toMatch(/0\s*todo/);
    expect(ledger.textContent).toMatch(/0\s*done/);
  });
});
