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
 * Notify / PR-monitor / rule sub-sections actually render. Individual tests
 * `delete` sub-tables off this to simulate a tmai-core binary that omits
 * `[orchestration.*]` tables absent from config.toml.
 */
function makeSettings(overrides: Partial<OrchestratorSettings> = {}): OrchestratorSettings {
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

  // A tmai-core binary omits the `[orchestration.notify]` / `[orchestration]`
  // rule sub-tables from the GET response when they are absent from
  // config.toml. NotifySettingsSection derefs `orchestrator.notify[...]` and
  // the rule textareas read `orchestrator.rules[...]`, so an omitted sub-table
  // used to throw and — with no error boundary around SettingsPanel — black out
  // the whole panel.
  it("renders the whole section when notify and rules are omitted from the wire", async () => {
    const stale = makeSettings();
    const partial = stale as Partial<OrchestratorSettings>;
    delete partial.notify;
    delete partial.rules;
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(stale);

    render(<OrchestrationSection projects={[]} />);

    // Sub-sections render without throwing…
    expect(await screen.findByText("Notifications")).toBeTruthy();
    expect(screen.getByText("PR Monitor")).toBeTruthy();
    // …rules default to empty textareas (clearly editable, not fabricated)…
    expect((screen.getByLabelText("Branch rules") as HTMLTextAreaElement).value).toBe("");
    // …and nothing rendered the literal string "undefined".
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it("applies engine default notify modes when notify is omitted", async () => {
    const stale = makeSettings();
    delete (stale as Partial<OrchestratorSettings>).notify;
    vi.mocked(api.getOrchestratorSettings).mockResolvedValue(stale);

    render(<OrchestrationSection projects={[]} />);

    await screen.findByText("Notifications");
    // The per-event tri-state rows render from the defaults…
    expect(screen.getByText("CI passed")).toBeTruthy();
    expect(screen.getByText("CI failed")).toBeTruthy();
    // …and the default mode for an omitted notify table is "notify" for most
    // events, so at least one "Notify" control is selected (not all "off").
    const notifySelected = screen
      .getAllByRole("button", { name: "Notify" })
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(notifySelected.length).toBeGreaterThan(0);
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
