// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProducerSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getProducerSettings: vi.fn(),
      updateProducerSettings: vi.fn(),
      getGeneralSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { ProducerSection } = await import("../ProducerSection");

/**
 * A fully-populated ProducerSettings with the orchestrator enabled so the
 * PR-monitor sub-section actually renders.
 */
function makeSettings(overrides: Partial<ProducerSettings> = {}): ProducerSettings {
  return {
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

describe("ProducerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: null });
  });

  // The orchestrator config rip (#583/#597) retired the role + workflow-rule
  // textareas. The section now hosts only scope, the enabled toggle, and the
  // composed PR Monitor sub-section — guard that the dead fields stay gone.
  it("renders the PR Monitor sub-section without the retired role/rules textareas", async () => {
    vi.mocked(api.getProducerSettings).mockResolvedValue(makeSettings());

    render(<ProducerSection projects={[]} />);

    expect(await screen.findByText("PR Monitor")).toBeTruthy();
    expect(screen.queryByLabelText("Role")).toBeNull();
    expect(screen.queryByLabelText("Branch rules")).toBeNull();
    expect(screen.queryByText("Workflow Rules")).toBeNull();
  });
});
