// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getOrchestrationSettings: vi.fn(),
      updateOrchestrationSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { OrchestrationDispatchSection } = await import("../OrchestrationDispatchSection");

const BASE_SETTINGS: OrchestrationSettings = {
  orchestrator: null,
  dispatch: {
    implementer: null,
    reviewer: null,
  },
};

const EXPLICIT_SETTINGS: OrchestrationSettings = {
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
};

describe("OrchestrationDispatchSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all three bundle sections after load", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(BASE_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      expect(screen.getByText("Orchestrator")).toBeTruthy();
      expect(screen.getByText("Implementer")).toBeTruthy();
      expect(screen.getByText("Reviewer")).toBeTruthy();
    });
  });

  it("shows legacy checkbox checked when bundles are null", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(BASE_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      // All three bundles null → all three checkboxes should be checked
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(true);
      }
    });
  });

  it("shows legacy checkbox unchecked when bundles are explicit", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    render(<OrchestrationDispatchSection />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole("checkbox");
      // All three bundles explicit → all three checkboxes should be unchecked
      for (const cb of checkboxes) {
        expect((cb as HTMLInputElement).checked).toBe(false);
      }
    });
  });

  it("switching vendor resets the model input to empty", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    render(<OrchestrationDispatchSection />);

    // Wait for render
    await waitFor(() => screen.getByText("Orchestrator"));

    // Get the first vendor select (Orchestrator)
    const vendorSelects = screen.getAllByRole("combobox", { name: /vendor for/i });
    const orchestratorVendor = vendorSelects[0];

    // Get corresponding model input (first model input)
    const modelInputs = screen.getAllByRole("textbox", { name: /model for/i });
    expect((modelInputs[0] as HTMLInputElement).value).toBe("claude-opus-4-6");

    // Switch vendor
    fireEvent.change(orchestratorVendor, { target: { value: "codex" } });

    // Model should be reset to empty
    await waitFor(() => {
      expect((modelInputs[0] as HTMLInputElement).value).toBe("");
    });
  });

  it("auto permission option is disabled for non-opus claude model", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      orchestrator: { vendor: "claude", model: "claude-sonnet-4-6" },
    });
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Orchestrator"));

    // Find the permission select for orchestrator
    const permissionSelects = screen.getAllByRole("combobox", { name: /permission mode for/i });
    const orchestratorPerm = permissionSelects[0];

    // auto option should be disabled
    const autoOption = Array.from(orchestratorPerm.querySelectorAll("option")).find(
      (o) => o.value === "auto",
    );
    expect(autoOption).toBeTruthy();
    expect((autoOption as HTMLOptionElement).disabled).toBe(true);
  });

  it("auto permission option is enabled for opus model", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      orchestrator: { vendor: "claude", model: "claude-opus-4-6" },
    });
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
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      dispatch: {
        implementer: null,
        reviewer: { vendor: "codex", model: "codex-1" },
      },
    });
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Reviewer"));

    // Third permission select → reviewer
    const permissionSelects = screen.getAllByRole("combobox", { name: /permission mode for/i });
    const reviewerPerm = permissionSelects[2];

    const autoOption = Array.from(reviewerPerm.querySelectorAll("option")).find(
      (o) => o.value === "auto",
    );
    expect(autoOption).toBeTruthy();
    expect((autoOption as HTMLOptionElement).disabled).toBe(true);
  });

  it("effort dropdown is hidden for codex vendor", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      dispatch: {
        implementer: null,
        reviewer: { vendor: "codex", model: "codex-1" },
      },
    });
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Reviewer"));

    // "n/a — codex" should be visible
    expect(screen.getByText("(n/a — codex)")).toBeTruthy();
  });

  it("effort dropdown is shown for claude vendor", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue({
      ...BASE_SETTINGS,
      orchestrator: { vendor: "claude", model: "claude-opus-4-6" },
    });
    render(<OrchestrationDispatchSection />);
    await waitFor(() => screen.getByText("Orchestrator"));

    // Effort select should exist for orchestrator (first effort combobox)
    const effortSelects = screen.getAllByRole("combobox", { name: /effort for/i });
    expect(effortSelects.length).toBeGreaterThan(0);
  });

  it("save calls updateOrchestrationSettings with the current bundle state", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestrationSettings).mockResolvedValue(undefined as never);
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(vi.mocked(api.updateOrchestrationSettings)).toHaveBeenCalledWith({
        orchestrator: EXPLICIT_SETTINGS.orchestrator,
        dispatch: EXPLICIT_SETTINGS.dispatch,
      });
    });
  });

  it("displays backend error on save failure", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestrationSettings).mockRejectedValue(
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

  it("send null for bundle when legacy checkbox is checked", async () => {
    vi.mocked(api.getOrchestrationSettings).mockResolvedValue(EXPLICIT_SETTINGS);
    vi.mocked(api.updateOrchestrationSettings).mockResolvedValue(undefined as never);
    render(<OrchestrationDispatchSection />);

    await waitFor(() => screen.getByText("Orchestrator"));

    // Check the orchestrator legacy checkbox
    const legacyCheckboxes = screen.getAllByRole("checkbox");
    fireEvent.click(legacyCheckboxes[0]); // orchestrator checkbox

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(vi.mocked(api.updateOrchestrationSettings)).toHaveBeenCalledWith(
        expect.objectContaining({ orchestrator: null }),
      );
    });
  });
});
