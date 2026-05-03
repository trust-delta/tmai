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
    },
  };
});

const { api } = await import("@/lib/api");
const { OrchestrationDispatchSection } = await import("../OrchestrationDispatchSection");

/**
 * Build a minimal OrchestratorSettings for the dispatch-section tests.
 * Other fields (notify, guardrails, role, ...) are filled with default-ish
 * placeholders since the section under test only reads `orchestrator` /
 * `dispatch`.
 */
function makeSettings(overrides: Partial<OrchestratorSettings>): OrchestratorSettings {
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
    guardrails: {
      max_ci_retries: 0,
      max_review_loops: 0,
      escalate_to_human_after: 0,
    },
    auto_action_templates: {
      ci_failed_implementer: "",
      review_feedback_implementer: "",
    },
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 0,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    is_project_override: false,
    orchestrator: null,
    dispatch: { implementer: null, reviewer: null },
    ...overrides,
  };
}

const BASE_SETTINGS = makeSettings({});

const EXPLICIT_SETTINGS = makeSettings({
  orchestrator: {
    vendor: "claude",
    model: "claude-opus-4-6",
    permission_mode: "auto",
    effort: "high",
  },
  dispatch: {
    implementer: {
      vendor: "claude",
      model: "claude-opus-4-6",
      permission_mode: "auto",
      effort: "high",
    },
    reviewer: { vendor: "codex", model: "codex-1", permission_mode: null, effort: null },
  },
});

describe("OrchestrationDispatchSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all three bundle sections after load", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(BASE_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      expect(screen.getByText("Orchestrator")).toBeTruthy();
      expect(screen.getByText("Implementer")).toBeTruthy();
      expect(screen.getByText("Reviewer")).toBeTruthy();
    });
  });

  it("shows default checkbox checked when bundles are null", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(BASE_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      // All three bundles null → all three "Use vendor CLI default" checkboxes
      // should be checked.
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(true);
      }
    });
  });

  it("shows default checkbox unchecked when bundles are explicit", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(false);
      }
    });
  });

  it("switching vendor resets the model input to empty", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    const vendorSelects = screen.getAllByRole("combobox", { name: /vendor for/i });
    const orchestratorVendor = vendorSelects[0];

    const modelInputs = screen.getAllByRole("textbox", { name: /model for/i });
    expect((modelInputs[0] as HTMLInputElement).value).toBe("claude-opus-4-6");

    fireEvent.change(orchestratorVendor, { target: { value: "codex" } });

    await waitFor(() => {
      expect((modelInputs[0] as HTMLInputElement).value).toBe("");
    });
  });

  it("auto permission option is disabled for non-opus claude model", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(
      makeSettings({
        orchestrator: { vendor: "claude", model: "claude-sonnet-4-6" },
      }),
    );
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Orchestrator"));

    const permissionSelects = screen.getAllByRole("combobox", { name: /permission mode for/i });
    const orchestratorPerm = permissionSelects[0];

    const autoOption = Array.from(orchestratorPerm.querySelectorAll("option")).find(
      (o) => o.value === "auto",
    );
    expect(autoOption).toBeTruthy();
    expect((autoOption as HTMLOptionElement).disabled).toBe(true);
  });

  it("auto permission option is enabled for opus model", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(
      makeSettings({
        orchestrator: { vendor: "claude", model: "claude-opus-4-6" },
      }),
    );
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Orchestrator"));

    const permissionSelects = screen.getAllByRole("combobox", { name: /permission mode for/i });
    const orchestratorPerm = permissionSelects[0];

    const autoOption = Array.from(orchestratorPerm.querySelectorAll("option")).find(
      (o) => o.value === "auto",
    );
    expect(autoOption).toBeTruthy();
    expect((autoOption as HTMLOptionElement).disabled).toBe(false);
  });

  it("auto permission option is disabled for non-claude vendor", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(
      makeSettings({
        dispatch: {
          implementer: null,
          reviewer: { vendor: "codex", model: "codex-1" },
        },
      }),
    );
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Reviewer"));

    const permissionSelects = screen.getAllByRole("combobox", { name: /permission mode for/i });
    const reviewerPerm = permissionSelects[2];

    const autoOption = Array.from(reviewerPerm.querySelectorAll("option")).find(
      (o) => o.value === "auto",
    );
    expect(autoOption).toBeTruthy();
    expect((autoOption as HTMLOptionElement).disabled).toBe(true);
  });

  it("effort dropdown is hidden for codex vendor", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(
      makeSettings({
        dispatch: {
          implementer: null,
          reviewer: { vendor: "codex", model: "codex-1" },
        },
      }),
    );
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Reviewer"));

    expect(screen.getByText("(n/a — codex)")).toBeTruthy();
  });

  it("effort dropdown is shown for claude vendor", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(
      makeSettings({
        orchestrator: { vendor: "claude", model: "claude-opus-4-6" },
      }),
    );
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Orchestrator"));

    const effortSelects = screen.getAllByRole("combobox", { name: /effort for/i });
    expect(effortSelects.length).toBeGreaterThan(0);
  });

  it("save calls updateOrchestratorSettings with the current bundle state", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestratorSettings).mockResolvedValue(undefined as never);
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(vi.mocked(api.updateOrchestratorSettings)).toHaveBeenCalledWith({
        orchestrator: EXPLICIT_SETTINGS.orchestrator,
        dispatch: EXPLICIT_SETTINGS.dispatch,
      });
    });
  });

  it("displays backend error on save failure", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestratorSettings).mockRejectedValue(
      new Error(
        "API error 400: [orchestration.dispatch.implementer] permission_mode `auto` is not allowed",
      ),
    );
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText(/permission_mode `auto` is not allowed/i)).toBeTruthy();
    });
  });

  it("sends null for the bundle when the default checkbox is checked", async () => {
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestratorSettings).mockResolvedValue(undefined as never);
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]); // orchestrator's "Use vendor CLI default"

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(vi.mocked(api.updateOrchestratorSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ orchestrator: null }),
      );
    });
  });
});
