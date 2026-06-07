// @vitest-environment jsdom
//
// RAimsSection — the aim-tree read view (Stage 1-B, #780 + #782) PLUS the
// write affordances (graduation Stage 2-B): create a node + edit a node's
// frontmatter (aim/parent/state only), backed by tmai-core's #501 endpoints.
// The section is a THIN entry (summary + glyph legend + an ⤢ open affordance);
// the actual 2D tree + the write forms live in a maximized overlay opened from
// it. Covers the wire-backed states (render / loading / empty / error / parked),
// the thin-entry summary, the overlay open / close (✕) / dismiss (Esc), the
// view machinery carried from prototype #778 (body-on-select detail pane,
// blast-radius highlight, the distinct dashed `depends_on` cross-edge, the
// neutral `dead` glyph), and the Stage 2-B write flows (create success +
// client/backend validation, edit save / cancel).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AimsResponse, AimWire } from "@/lib/api";

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

function aimStub(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
  return {
    aim: `aim ${overrides.slug}`,
    parent: null,
    state: "open",
    depends_on: [],
    serves: [],
    related: [],
    body: "",
    ...overrides,
  };
}

function responseStub(aims: AimWire[] = []): AimsResponse {
  return {
    unit: "u",
    composed_at: "2026-06-07T00:00:00Z",
    repos: [
      {
        repo_label: "tmai-core",
        repo_root: "/p/tmai-core",
        primary: true,
        repo_head: null,
        aims,
      },
    ],
  };
}

// The validated probe shape: two roots, a nested subtree, a depends_on
// cross-edge, a dead node, and a body.
const TREE: AimWire[] = [
  aimStub({ slug: "amplify-human-judgment", aim: "人間の判断を増幅する" }),
  aimStub({
    slug: "attention-per-artifact",
    aim: "注意を per-artifact に",
    parent: "amplify-human-judgment",
    body: "観測 → 判断 → dispatch のループ。\n[confirmed: #769] storage + wire",
  }),
  aimStub({
    slug: "attention-backend",
    aim: "storage + wire",
    parent: "attention-per-artifact",
    state: "done",
  }),
  aimStub({ slug: "aim-system", aim: "records を書く構造に" }),
  aimStub({
    slug: "aim-authority",
    aim: "authority = event-driven amendment",
    parent: "aim-system",
    depends_on: ["aim-honesty"],
    serves: ["amplify-human-judgment"],
    related: ["aim-shared-means"],
  }),
  aimStub({ slug: "aim-honesty", aim: "confirmed ⊥ claimed", parent: "aim-system", state: "dead" }),
];

beforeEach(() => {
  aimsMock.mockReset();
  createAimMock.mockReset();
  editAimMock.mockReset();
});

// Open the maximized overlay from the thin entry, returning the dialog element.
async function openOverlay() {
  const openBtn = await screen.findByRole("button", { name: /Open aim-tree/ });
  fireEvent.click(openBtn);
  return screen.findByRole("dialog", { name: "Aim-tree" });
}

describe("RAimsSection — thin entry", () => {
  it("shows a compact summary (aim + root count) and an open affordance, not the canvas", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    // Summary: 6 aims across 2 roots (amplify-human-judgment + aim-system).
    // The root count sits in its own foreground span, so assert on the full
    // summary text rather than a single contiguous text node.
    await waitFor(() => {
      expect(screen.getByText(/6 aims/)).toBeTruthy();
    });
    expect(screen.getByText(/6 aims/).textContent).toContain("2 root");
    // The open affordance is present…
    expect(screen.getByRole("button", { name: /Open aim-tree/ })).toBeTruthy();
    // …but the maximized tree is NOT mounted until it is clicked.
    expect(screen.queryByRole("dialog", { name: "Aim-tree" })).toBeNull();
    expect(screen.queryByText("人間の判断を増幅する")).toBeNull();
  });

  it("header count is the plain total node count (no severity styling)", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    const { container } = render(<RAimsSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(`${TREE.length}`)).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("shows a loading placeholder during the initial fetch", () => {
    // A pending promise keeps the hook in its initial loading state.
    aimsMock.mockReturnValue(new Promise<AimsResponse>(() => {}));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("stays actionable at zero aims (summary + open, so the first node can be authored)", async () => {
    // Stage 2-B: unlike the read-only Stage 1-B's terminal "No aims."
    // placeholder, an empty tree must still expose the create path so the
    // operator can author the first node.
    aimsMock.mockResolvedValue(responseStub([]));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/0 aims/)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Open aim-tree/ })).toBeTruthy();
    // The overlay opens and exposes the create affordance even with no nodes.
    await openOverlay();
    expect(screen.getByRole("button", { name: /New aim node/ })).toBeTruthy();
  });

  it("surfaces a fetch error", async () => {
    aimsMock.mockRejectedValue(new Error("boom"));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load aims: boom/)).toBeTruthy();
    });
  });

  it("parks with a placeholder when no project is selected (no fetch)", () => {
    render(<RAimsSection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project to see aims\./)).toBeTruthy();
    expect(aimsMock).not.toHaveBeenCalled();
  });
});

describe("RAimsSection — maximized overlay", () => {
  it("opens the overlay on ⤢ click, rendering every aim node (anchor + slug)", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await openOverlay();

    expect(screen.getByText("人間の判断を増幅する")).toBeTruthy();
    expect(screen.getByText("records を書く構造に")).toBeTruthy();
    // The slug shows under the anchor inside the node box.
    expect(screen.getByText("attention-per-artifact")).toBeTruthy();
  });

  it("dismisses via the ✕ close button", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: /Close aim-tree/ }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Aim-tree" })).toBeNull();
    });
  });

  it("dismisses via Esc", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await openOverlay();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Aim-tree" })).toBeNull();
    });
  });

  it("selecting a node opens its body in the detail pane and reports the blast radius", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();

    const node = await screen.findByRole("button", {
      name: /attention-per-artifact/,
    });
    fireEvent.click(node);

    // Body-on-select: the raw markdown body renders read-only in the detail
    // pane (scoped — the anchor/slug also appear in the tree node boxes).
    const detail = await screen.findByTestId("aim-detail");
    expect(within(detail).getByText(/storage \+ wire/)).toBeTruthy();
    // Blast radius: attention-per-artifact has one descendant (attention-backend).
    // The count is split into its own span, so assert on the pane's text.
    expect(detail.textContent).toContain("1 descendant");
  });

  it("lists depends_on / serves / related as slug text in the detail pane", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();

    const node = await screen.findByRole("button", { name: /aim-authority/ });
    fireEvent.click(node);

    const detail = await screen.findByTestId("aim-detail");
    // Cross-edges list as slug text, scoped to the detail pane.
    expect(within(detail).getByText("aim-honesty")).toBeTruthy(); // depends_on (drawn too)
    expect(within(detail).getByText("amplify-human-judgment")).toBeTruthy(); // serves
    expect(within(detail).getByText("aim-shared-means")).toBeTruthy(); // related
  });

  it("draws depends_on as a distinct dashed cross-edge path", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    await screen.findByText("authority = event-driven amendment");
    // The cross-edge is a <path> with a dasharray (the legend uses a <line>,
    // so querying for path[stroke-dasharray] targets the edge specifically).
    // The overlay is portalled to document.body, so query the document.
    const dashed = document.querySelector('path[stroke-dasharray="4 3"]');
    expect(dashed).not.toBeNull();
  });

  it("renders the dead state with a neutral glyph and no severity color", async () => {
    aimsMock.mockResolvedValue(
      responseStub([aimStub({ slug: "x", aim: "dead aim", state: "dead" })]),
    );
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    await screen.findByText("dead aim");
    // Neutral shape glyph for dead — no heat / severity color anywhere.
    expect(screen.getAllByText("⊘").length).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });
});

describe("RAimsSection — Stage 2-B create", () => {
  it("creates a node from the form and reflects it after the refresh", async () => {
    const created = aimStub({ slug: "new-node", aim: "the new bearing" });
    // Initial fetch is the base tree; the post-create refresh includes the new
    // node so it lands in the canvas.
    aimsMock.mockResolvedValueOnce(responseStub(TREE));
    aimsMock.mockResolvedValue(responseStub([...TREE, created]));
    createAimMock.mockResolvedValue(created);

    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();

    fireEvent.click(screen.getByRole("button", { name: /New aim node/ }));
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "new-node" } });
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "the new bearing" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "new-node",
        aim: "the new bearing",
        parent: null,
      });
    });
    // The refresh re-fetch surfaces the new node (in the canvas node box, and
    // — since create selects it — the detail pane too, hence getAllByText).
    await waitFor(() => {
      expect(screen.getAllByText("the new bearing").length).toBeGreaterThan(0);
    });
  });

  it("passes the selected parent through on create", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    createAimMock.mockResolvedValue(aimStub({ slug: "child", aim: "c", parent: "aim-system" }));

    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: /New aim node/ }));
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "child" } });
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "c" } });
    fireEvent.change(screen.getByLabelText("parent"), { target: { value: "aim-system" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createAimMock).toHaveBeenCalledWith("u", {
        slug: "child",
        aim: "c",
        parent: "aim-system",
      });
    });
  });

  it("blocks create on a client-invalid slug (dated) without calling the API", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: /New aim node/ }));
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "2026-01-02-x" } });
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "a" } });

    expect(screen.getByText(/NON-dated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toHaveProperty("disabled", true);
    expect(createAimMock).not.toHaveBeenCalled();
  });

  it("flags a duplicate slug client-side before the API", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: /New aim node/ }));
    // `aim-system` already exists in TREE.
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "aim-system" } });
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "a" } });

    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toHaveProperty("disabled", true);
    expect(createAimMock).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection (409/422) inline", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    // Client-valid, non-duplicate slug that the backend nonetheless rejects
    // (e.g. a race, or a rule the client mirror does not enforce).
    createAimMock.mockRejectedValue(new Error("aim 'racy-node' already exists"));

    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    fireEvent.click(screen.getByRole("button", { name: /New aim node/ }));
    fireEvent.change(screen.getByLabelText("slug"), { target: { value: "racy-node" } });
    fireEvent.change(screen.getByLabelText("aim"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("already exists");
    });
  });
});

describe("RAimsSection — Stage 2-B edit", () => {
  async function selectAndEdit(slug: string) {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await openOverlay();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(slug) }));
    const detail = await screen.findByTestId("aim-detail");
    fireEvent.click(within(detail).getByRole("button", { name: /Edit frontmatter/ }));
    return detail;
  }

  it("saves an edited aim / parent / state and re-fetches", async () => {
    editAimMock.mockResolvedValue(aimStub({ slug: "aim-system", aim: "edited bearing" }));
    const detail = await selectAndEdit("aim-system");

    fireEvent.change(within(detail).getByLabelText("aim"), {
      target: { value: "edited bearing" },
    });
    fireEvent.change(within(detail).getByLabelText("state"), { target: { value: "done" } });
    fireEvent.click(within(detail).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(editAimMock).toHaveBeenCalledWith("u", "aim-system", {
        aim: "edited bearing",
        parent: null,
        state: "done",
      });
    });
    // refresh() re-invokes the aims fetch after the write.
    await waitFor(() => {
      expect(aimsMock.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("cancel leaves the node untouched (no API call)", async () => {
    const detail = await selectAndEdit("aim-system");
    fireEvent.change(within(detail).getByLabelText("aim"), { target: { value: "scrapped" } });
    fireEvent.click(within(detail).getByRole("button", { name: "Cancel" }));

    // Back to the read-only facts; no edit was sent.
    expect(within(detail).getByText(/Edit frontmatter/)).toBeTruthy();
    expect(editAimMock).not.toHaveBeenCalled();
  });

  it("excludes the node itself and its descendants from the parent options (no cycles)", async () => {
    // Select amplify-human-judgment (root): its descendants are
    // attention-per-artifact + attention-backend; none — nor itself — may
    // become its parent.
    const detail = await selectAndEdit("amplify-human-judgment");
    const parentSelect = within(detail).getByLabelText("parent") as HTMLSelectElement;
    const options = Array.from(parentSelect.options).map((o) => o.value);
    expect(options).not.toContain("amplify-human-judgment");
    expect(options).not.toContain("attention-per-artifact");
    expect(options).not.toContain("attention-backend");
    // A node outside the subtree is still a valid parent.
    expect(options).toContain("aim-system");
  });
});
