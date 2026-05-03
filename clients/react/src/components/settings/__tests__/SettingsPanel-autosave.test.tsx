// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AutoApproveSettings,
  OrchestratorSettings,
  SpawnSettings,
  UsageSettings,
  WorkflowSettings,
  WorktreeSettings,
} from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listProjects: vi.fn(),
      getSpawnSettings: vi.fn(),
      updateSpawnSettings: vi.fn(),
      getAutoApproveSettings: vi.fn(),
      updateAutoApproveMode: vi.fn(),
      updateAutoApproveFields: vi.fn(),
      updateAutoApproveRules: vi.fn(),
      getUsageSettings: vi.fn(),
      updateUsageSettings: vi.fn(),
      getOrchestratorSettings: vi.fn(),
      updateOrchestratorSettings: vi.fn(),
      getNotificationSettings: vi.fn(),
      updateNotificationSettings: vi.fn(),
      getWorkflowSettings: vi.fn(),
      updateWorkflowSettings: vi.fn(),
      getWorktreeSettings: vi.fn(),
      updateWorktreeSettings: vi.fn(),
      // ScheduledKicksSection (rendered as part of SettingsPanel) loads its
      // own data on mount — stub the read so the section does not throw.
      listScheduledKicks: vi.fn().mockResolvedValue([]),
      createScheduledKick: vi.fn(),
      updateScheduledKick: vi.fn(),
      deleteScheduledKick: vi.fn(),
      dryRunKick: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { SettingsPanel } = await import("../SettingsPanel");

// ── Fixtures ──────────────────────────────────────────────────────────

const SPAWN: SpawnSettings = {
  runtime: "tmux",
  tmux_available: true,
  tmux_window_name: "tmai",
};

const AUTO_APPROVE: AutoApproveSettings = {
  enabled: false,
  mode: "off",
  running: false,
  provider: "claude_haiku",
  model: "claude-haiku-4-5",
  timeout_secs: 30,
  cooldown_secs: 5,
  check_interval_ms: 1000,
  max_concurrent: 4,
  allowed_types: [],
  rules: {
    allow_read: true,
    allow_tests: true,
    allow_fetch: false,
    allow_git_readonly: true,
    allow_format_lint: true,
    allow_tmai_mcp: true,
    allow_patterns: [],
  },
};

const USAGE: UsageSettings = {
  enabled: false,
  auto_refresh_min: 30,
};

const WORKFLOW: WorkflowSettings = { auto_rebase_on_merge: false };
const WORKTREE: WorktreeSettings = {
  setup_commands: [],
  setup_timeout_secs: 300,
  branch_depth_warning: 5,
};

function makeOrchestrator(): OrchestratorSettings {
  return {
    enabled: true,
    role: "",
    rules: { branch: "", merge: "", review: "", custom: "" },
    notify: {
      on_agent_stopped: "off",
      on_agent_error: "off",
      on_rebase_conflict: "off",
      on_ci_passed: "off",
      on_ci_failed: "off",
      on_pr_created: "off",
      on_pr_comment: "off",
      on_pr_closed: "off",
      on_guardrail_exceeded: "off",
      templates: {
        agent_stopped: "",
        agent_error: "",
        ci_passed: "",
        ci_failed: "",
        pr_created: "",
        pr_comment: "",
        rebase_conflict: "",
        pr_closed: "",
        guardrail_exceeded: "",
      },
      default_templates: {
        agent_stopped: "",
        agent_error: "",
        ci_passed: "",
        ci_failed: "",
        pr_created: "",
        pr_comment: "",
        rebase_conflict: "",
        pr_closed: "",
        guardrail_exceeded: "",
      },
      suppress_self: false,
      notify_on_human_action: false,
      notify_on_agent_action: false,
      notify_on_system_action: false,
    },
    guardrails: { max_ci_retries: 3, max_review_loops: 3, escalate_to_human_after: 3 },
    auto_action_templates: {
      ci_failed_implementer: "",
      review_feedback_implementer: "",
    },
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 60,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    is_project_override: false,
    orchestrator: null,
    dispatch: { implementer: null, reviewer: null },
  };
}

function setupDefaults() {
  vi.mocked(api.listProjects).mockResolvedValue([]);
  vi.mocked(api.getSpawnSettings).mockResolvedValue(SPAWN);
  vi.mocked(api.getAutoApproveSettings).mockResolvedValue(AUTO_APPROVE);
  vi.mocked(api.getUsageSettings).mockResolvedValue(USAGE);
  vi.mocked(api.getOrchestratorSettings).mockResolvedValue(makeOrchestrator());
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

  it("atomic dropdown change persists with a single PUT", async () => {
    vi.mocked(api.updateAutoApproveMode).mockResolvedValue(undefined as never);
    render(<SettingsPanel onClose={() => {}} onProjectsChanged={() => {}} />);

    // Wait for the auto-approve mode <select> to appear.
    const modeSelect = await waitFor(() => {
      const sel = screen.getAllByRole("combobox").find((s) => {
        const opts = Array.from(s.querySelectorAll("option")).map((o) => o.value);
        return opts.includes("rules") && opts.includes("ai");
      });
      if (!sel) throw new Error("auto-approve mode select not found yet");
      return sel as HTMLSelectElement;
    });

    fireEvent.change(modeSelect, { target: { value: "rules" } });

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveMode)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(api.updateAutoApproveMode)).toHaveBeenCalledWith("rules");
  });

  it("typing in the tmux window-name text field does NOT trigger PUT mid-stream", async () => {
    vi.mocked(api.updateSpawnSettings).mockResolvedValue(undefined as never);
    render(<SettingsPanel onClose={() => {}} onProjectsChanged={() => {}} />);

    // Window name input only renders when runtime === "tmux" (our fixture).
    const input = await waitFor(() => {
      const candidate = screen
        .getAllByRole("textbox")
        .find((el) => (el as HTMLInputElement).value === "tmai");
      if (!candidate) throw new Error("tmux window-name input not found yet");
      return candidate as HTMLInputElement;
    });

    fireEvent.change(input, { target: { value: "tma" } });
    fireEvent.change(input, { target: { value: "tmai-renamed" } });

    expect(vi.mocked(api.updateSpawnSettings)).not.toHaveBeenCalled();
  });

  it("blurring the tmux window-name text field commits with a PUT", async () => {
    vi.mocked(api.updateSpawnSettings).mockResolvedValue(undefined as never);
    render(<SettingsPanel onClose={() => {}} onProjectsChanged={() => {}} />);

    const input = await waitFor(() => {
      const candidate = screen
        .getAllByRole("textbox")
        .find((el) => (el as HTMLInputElement).value === "tmai");
      if (!candidate) throw new Error("tmux window-name input not found yet");
      return candidate as HTMLInputElement;
    });

    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateSpawnSettings)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(api.updateSpawnSettings)).toHaveBeenCalledWith({
      runtime: "tmux",
      tmux_window_name: "renamed",
    });
  });

  it("backend 400 on an atomic toggle surfaces inline under the section and rolls back", async () => {
    vi.mocked(api.updateWorkflowSettings).mockRejectedValue(
      new Error("API error 400: cannot enable auto-rebase while a rebase is in progress"),
    );
    render(<SettingsPanel onClose={() => {}} onProjectsChanged={() => {}} />);

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

  it("backend 400 on a text-field commit keeps the user's input intact", async () => {
    vi.mocked(api.updateSpawnSettings).mockRejectedValue(
      new Error("API error 400: window name `bad name` contains invalid character"),
    );
    render(<SettingsPanel onClose={() => {}} onProjectsChanged={() => {}} />);

    const input = await waitFor(() => {
      const candidate = screen
        .getAllByRole("textbox")
        .find((el) => (el as HTMLInputElement).value === "tmai");
      if (!candidate) throw new Error("tmux window-name input not found yet");
      return candidate as HTMLInputElement;
    });

    fireEvent.change(input, { target: { value: "bad name" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(screen.getByText(/window name `bad name` contains invalid character/i)).toBeTruthy();
    });

    // Local draft preserved so the user can edit and retry.
    expect(input.value).toBe("bad name");
  });
});
