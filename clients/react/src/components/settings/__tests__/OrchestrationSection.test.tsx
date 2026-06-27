// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
 * PR-monitor sub-section actually renders.
 */
function makeSettings(overrides: Partial<OrchestratorSettings> = {}): OrchestratorSettings {
  return {
    enabled: true,
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 60,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    auto_handoff_threshold_pct: 75,
    is_project_override: false,
    dispatch: { implementer: null },
    ...overrides,
  };
}

describe("OrchestrationSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: null });
  });

  // The orchestrator config rip (#583/#597) retired the role + workflow-rule
  // textareas. The section now hosts only scope, the enabled toggle, and the
  // composed PR Monitor sub-section — guard that the dead fields stay gone.
  it("renders the PR Monitor sub-section without the retired role/rules textareas", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(makeSettings());

    render(<OrchestrationSection projects={[]} />);

    expect(await screen.findByText("PR Monitor")).toBeTruthy();
    expect(screen.queryByLabelText("Role")).toBeNull();
    expect(screen.queryByLabelText("Branch rules")).toBeNull();
    expect(screen.queryByText("Workflow Rules")).toBeNull();
  });
});
