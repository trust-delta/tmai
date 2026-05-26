// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getOrchestratorSettings: vi.fn(),
      updateOrchestratorSettings: vi.fn(),
      getGeneralSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { OrchestrationSection } = await import("../OrchestrationSection");

/**
 * A fully-populated OrchestratorSettings with the orchestrator enabled so the
 * PR-monitor / rule sub-sections actually render. Individual tests `delete`
 * sub-tables off this to simulate a tmai-core binary that omits
 * `[orchestration.*]` tables absent from config.toml.
 */
function makeSettings(overrides: Partial<OrchestratorSettings> = {}): OrchestratorSettings {
  return {
    enabled: true,
    role: "",
    rules: { branch: "", merge: "", review: "", custom: "" },
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 60,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    auto_handoff_threshold_pct: 75,
    is_project_override: false,
    orchestrator: null,
    dispatch: { implementer: null, reviewer: null },
    ...overrides,
  };
}

describe("OrchestrationSection — missing-sub-table tolerance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: null });
  });

  // A tmai-core binary omits the `[orchestration]` rule sub-table from the GET
  // response when it is absent from config.toml. The rule textareas read
  // `orchestrator.rules[...]`, so an omitted sub-table used to throw and — with
  // no error boundary around SettingsPanel — black out the whole panel.
  it("renders the whole section when rules are omitted from the wire", async () => {
    const stale = makeSettings();
    const partial = stale as Partial<OrchestratorSettings>;
    delete partial.rules;
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(stale);

    render(<OrchestrationSection projects={[]} />);

    // Sub-sections render without throwing…
    expect(await screen.findByText("PR Monitor")).toBeTruthy();
    // …rules default to empty textareas (clearly editable, not fabricated)…
    expect((screen.getByLabelText("Branch rules") as HTMLTextAreaElement).value).toBe("");
    // …and nothing rendered the literal string "undefined".
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  // Defaulting must not freeze the inputs — an edit still round-trips a PUT.
  it("keeps the defaulted rule textareas editable (blur commits a PUT)", async () => {
    const stale = makeSettings();
    delete (stale as Partial<OrchestratorSettings>).rules;
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(stale);
    vi.mocked(api.updateOrchestratorSettings).mockResolvedValue(undefined as never);

    render(<OrchestrationSection projects={[]} />);

    const branch = (await screen.findByLabelText("Branch rules")) as HTMLTextAreaElement;
    fireEvent.change(branch, { target: { value: "squash only" } });
    fireEvent.blur(branch);

    await waitFor(() => {
      expect(vi.mocked(api.updateOrchestratorSettings)).toHaveBeenCalled();
    });
    expect(vi.mocked(api.updateOrchestratorSettings).mock.calls[0][0]).toMatchObject({
      rules: { branch: "squash only" },
    });
  });
});
