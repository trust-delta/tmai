// @vitest-environment jsdom
//
// RAimsSection — the aim-tree read view (graduation Stage 1-B, #780). Covers
// the wire-backed states (render / loading / empty / error / parked) and the
// view machinery carried from prototype #778: body-on-select detail pane,
// blast-radius highlight, the distinct dashed `depends_on` cross-edge, and the
// neutral `dead` glyph with no severity color. Read-only — there is NO write
// affordance (frontmatter edit / new node are Stage 2).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AimsResponse, AimWire } from "@/lib/api";

const aimsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      aims: (...args: unknown[]) => aimsMock(...args),
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
});

describe("RAimsSection", () => {
  it("renders each aim node (anchor + slug)", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));

    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("人間の判断を増幅する")).toBeTruthy();
    });
    expect(screen.getByText("records を書く構造に")).toBeTruthy();
    // The slug shows under the anchor inside the node box.
    expect(screen.getByText("attention-per-artifact")).toBeTruthy();
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

  it("shows a placeholder when there are no aims", async () => {
    aimsMock.mockResolvedValue(responseStub([]));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("No aims.")).toBeTruthy();
    });
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

  it("selecting a node opens its body in the detail pane and reports the blast radius", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

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
    const { container } = render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await screen.findByText("authority = event-driven amendment");
    // The cross-edge is a <path> with a dasharray (the legend uses a <line>,
    // so querying for path[stroke-dasharray] targets the edge specifically).
    const dashed = container.querySelector('path[stroke-dasharray="4 3"]');
    expect(dashed).not.toBeNull();
  });

  it("renders the dead state with a neutral glyph and no severity color", async () => {
    aimsMock.mockResolvedValue(
      responseStub([aimStub({ slug: "x", aim: "dead aim", state: "dead" })]),
    );
    const { container } = render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await screen.findByText("dead aim");
    // Neutral shape glyph for dead — no heat / severity color anywhere.
    expect(screen.getAllByText("⊘").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("does NOT render a write affordance (Stage 2 is out of scope)", async () => {
    aimsMock.mockResolvedValue(responseStub(TREE));
    render(<RAimsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await screen.findByText("records を書く構造に");
    // No "New node" / "Add child" / "Create" affordance carried from the
    // prototype — this is the read-only view.
    expect(screen.queryByText(/New node/i)).toBeNull();
    expect(screen.queryByText(/Add child/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Create/ })).toBeNull();
  });
});
