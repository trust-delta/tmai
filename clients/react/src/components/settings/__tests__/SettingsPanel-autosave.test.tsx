// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProducerSettings, WorkflowSettings, WorktreeSettings } from "@/lib/api";
import { renderWithProviders as render } from "@/test/render";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listAgents: vi.fn(),
      getGeneralSettings: vi.fn(),
      updateGeneralSettings: vi.fn(),
      getProducerSettings: vi.fn(),
      updateProducerSettings: vi.fn(),
      getNotificationSettings: vi.fn(),
      updateNotificationSettings: vi.fn(),
      getWorkflowSettings: vi.fn(),
      updateWorkflowSettings: vi.fn(),
      getWorktreeSettings: vi.fn(),
      updateWorktreeSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { SettingsPanel } = await import("../SettingsPanel");

// ── Fixtures ──────────────────────────────────────────────────────────

const WORKFLOW: WorkflowSettings = { auto_rebase_on_merge: false };
const WORKTREE: WorktreeSettings = {
  setup_commands: [],
  setup_timeout_secs: 300,
  branch_depth_warning: 5,
};

function makeOrchestrator(): ProducerSettings {
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
  };
}

function setupDefaults() {
  vi.mocked(api.listAgents).mockResolvedValue([]);
  vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: null });
  vi.mocked(api.getProducerSettings).mockResolvedValue(makeOrchestrator());
  vi.mocked(api.getNotificationSettings).mockResolvedValue({
    notify_on_idle: true,
    notify_idle_threshold_secs: 10,
  });
  vi.mocked(api.getWorkflowSettings).mockResolvedValue(WORKFLOW);
  vi.mocked(api.getWorktreeSettings).mockResolvedValue(WORKTREE);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SettingsPanel — auto-save acceptance (#578)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it("backend 400 on an atomic toggle surfaces inline under the section and rolls back", async () => {
    vi.mocked(api.updateWorkflowSettings).mockRejectedValue(
      new Error("API error 400: cannot enable auto-rebase while a rebase is in progress"),
    );
    render(<SettingsPanel onClose={() => {}} />);

    // Wait for the workflow section to load and find the auto-rebase toggle.
    await waitFor(() => screen.getByText("Workflow"));
    const toggleLabel = screen.getByText("Auto-rebase on merge").closest("label");
    expect(toggleLabel).toBeTruthy();
    const toggleBtn = toggleLabel?.querySelector("button[type='button']");
    expect(toggleBtn).toBeTruthy();

    fireEvent.click(toggleBtn as HTMLButtonElement);

    await waitFor(() => {
      expect(
        screen.getByText(/cannot enable auto-rebase while a rebase is in progress/i),
      ).toBeTruthy();
    });
    // The PUT was attempted exactly once.
    expect(vi.mocked(api.updateWorkflowSettings)).toHaveBeenCalledTimes(1);
  });
});
