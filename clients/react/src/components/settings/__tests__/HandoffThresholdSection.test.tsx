// @vitest-environment jsdom
//
// HandoffThresholdSection — auto-handoff threshold control. Verifies:
//   - reads current value from `api.getOrchestratorSettings()`
//   - PUT round-trip via `api.updateOrchestratorSettings`
//   - 0 ⇒ "Disabled" label
//   - out-of-range values surface inline validation error and skip PUT

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorSettings } from "@/lib/api";
import { HandoffThresholdSection } from "../HandoffThresholdSection";

const getMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getOrchestratorSettings: () => getMock(),
      updateOrchestratorSettings: (params: unknown) => updateMock(params),
    },
  };
});

function orchestrator(threshold: number): OrchestratorSettings {
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
    auto_action_templates: { ci_failed_implementer: "", review_feedback_implementer: "" },
    pr_monitor_enabled: false,
    pr_monitor_interval_secs: 60,
    pr_monitor_exclude_authors: [],
    pr_monitor_scope: "current_project",
    inject_state_snapshot: false,
    auto_handoff_threshold_pct: threshold,
    is_project_override: false,
    orchestrator: null,
    dispatch: { implementer: null, reviewer: null },
  };
}

describe("HandoffThresholdSection", () => {
  beforeEach(() => {
    getMock.mockReset();
    updateMock.mockReset();
  });

  it("renders the current value once loaded", async () => {
    getMock.mockResolvedValue(orchestrator(80));
    render(<HandoffThresholdSection />);
    await waitFor(() => {
      const input = screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
      expect(input.value).toBe("80");
    });
    expect(screen.getByText(/Triggers at 80%/)).toBeTruthy();
  });

  it("0 renders as Disabled and does not show a percent", async () => {
    getMock.mockResolvedValue(orchestrator(0));
    render(<HandoffThresholdSection />);
    await waitFor(() => {
      expect(screen.getByText(/Disabled/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Triggers at/)).toBeNull();
  });

  // Defensive guard against a pre-handoff-lifecycle tmai-core binary that
  // omits `auto_handoff_threshold_pct` from the wire — the row must read
  // "Disabled" (truthful) rather than fabricate "Triggers at undefined%".
  it("missing wire field renders as Disabled (not 'Triggers at undefined%')", async () => {
    const stale = orchestrator(0);
    delete (stale as Partial<OrchestratorSettings>).auto_handoff_threshold_pct;
    getMock.mockResolvedValue(stale);
    render(<HandoffThresholdSection />);
    await waitFor(() => {
      const input = screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
      expect(input.value).toBe("0");
    });
    expect(screen.getByText(/Disabled/i)).toBeTruthy();
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.queryByText(/Triggers at/)).toBeNull();
  });

  it("blur commits a valid edit via PUT round-trip", async () => {
    getMock.mockResolvedValue(orchestrator(75));
    updateMock.mockResolvedValue(undefined);
    render(<HandoffThresholdSection />);
    const input = await waitFor(() => {
      return screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    expect(updateMock).toHaveBeenCalledWith({ auto_handoff_threshold_pct: 60 });
    expect(screen.getByText(/Triggers at 60%/)).toBeTruthy();
  });

  it("out-of-range (>100) shows validation error and skips PUT", async () => {
    getMock.mockResolvedValue(orchestrator(75));
    render(<HandoffThresholdSection />);
    const input = await waitFor(() => {
      return screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/between 0 and 100/);
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("negative value is rejected and PUT is skipped", async () => {
    getMock.mockResolvedValue(orchestrator(75));
    render(<HandoffThresholdSection />);
    const input = await waitFor(() => {
      return screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/between 0 and 100/);
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("non-integer value is rejected", async () => {
    getMock.mockResolvedValue(orchestrator(75));
    render(<HandoffThresholdSection />);
    const input = await waitFor(() => {
      return screen.getByLabelText(/Auto-handoff threshold percent/i) as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: "72.5" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/whole number/);
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
