// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoApproveSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getAutoApproveSettings: vi.fn(),
      updateAutoApproveMode: vi.fn(),
      updateAutoApproveFields: vi.fn(),
      updateAutoApproveRules: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { AutoApproveSection } = await import("../AutoApproveSection");

function makeSettings(overrides: Partial<AutoApproveSettings> = {}): AutoApproveSettings {
  return {
    enabled: true,
    mode: "rules",
    running: true,
    rules: {
      allow_read: true,
      allow_tests: false,
      allow_fetch: false,
      allow_git_readonly: false,
      allow_format_lint: false,
      allow_tmai_mcp: false,
      allow_patterns: [],
    },
    provider: "anthropic",
    model: "claude-haiku-4-5",
    timeout_secs: 5,
    cooldown_secs: 0,
    check_interval_ms: 250,
    allowed_types: [],
    max_concurrent: 4,
    ...overrides,
  };
}

describe("AutoApproveSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while settings are loading", () => {
    vi.mocked(api.getAutoApproveSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<AutoApproveSection />);
    expect(container.firstChild).toBeNull();
  });

  it("loads settings and renders the heading", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings());
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));
  });

  it("changing mode triggers updateAutoApproveMode", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings({ mode: "off" }));
    vi.mocked(api.updateAutoApproveMode).mockResolvedValue(undefined as never);
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    const modeSelect = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: "rules" } });

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveMode)).toHaveBeenCalledWith("rules");
    });
  });

  it("toggling enabled triggers updateAutoApproveFields and rolls back on error", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings({ enabled: true }));
    vi.mocked(api.updateAutoApproveFields).mockRejectedValue(new Error("boom"));
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    const toggle = screen.getByLabelText("Auto-approve enabled");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveFields)).toHaveBeenCalledWith({ enabled: false });
      expect(screen.getByText(/boom/)).toBeTruthy();
    });
  });

  it("toggling a rule preset triggers updateAutoApproveRules", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(
      makeSettings({
        rules: {
          allow_read: false,
          allow_tests: false,
          allow_fetch: false,
          allow_git_readonly: false,
          allow_format_lint: false,
          allow_tmai_mcp: false,
          allow_patterns: [],
        },
      }),
    );
    vi.mocked(api.updateAutoApproveRules).mockResolvedValue(undefined as never);
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    const readToggle = screen.getByLabelText("Rule preset Read operations");
    fireEvent.click(readToggle);

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveRules)).toHaveBeenCalledWith({ allow_read: true });
    });
  });

  it("adding a custom pattern via Enter triggers updateAutoApproveRules", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.updateAutoApproveRules).mockResolvedValue(undefined as never);
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    const patternInput = screen.getByLabelText("Add custom pattern") as HTMLInputElement;
    fireEvent.change(patternInput, { target: { value: "cargo build.*" } });
    fireEvent.keyDown(patternInput, { key: "Enter" });

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveRules)).toHaveBeenCalledWith({
        allow_patterns: ["cargo build.*"],
      });
    });
  });

  it("provider field commits on blur and rolls back on error", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings({ mode: "ai" }));
    vi.mocked(api.updateAutoApproveFields).mockRejectedValue(
      new Error("API error 400: bad provider"),
    );
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    const providerInput = screen.getByLabelText("Auto-approve provider") as HTMLInputElement;
    fireEvent.change(providerInput, { target: { value: "openai" } });
    fireEvent.blur(providerInput);

    await waitFor(() => {
      expect(vi.mocked(api.updateAutoApproveFields)).toHaveBeenCalledWith({ provider: "openai" });
      expect(screen.getByText(/bad provider/)).toBeTruthy();
    });
  });

  it("does not show AI provider fields when mode is rules", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings({ mode: "rules" }));
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    expect(screen.queryByLabelText("Auto-approve provider")).toBeNull();
  });

  it("shows AI provider fields when mode is hybrid", async () => {
    vi.mocked(api.getAutoApproveSettings).mockResolvedValue(makeSettings({ mode: "hybrid" }));
    render(<AutoApproveSection />);
    await waitFor(() => screen.getByText("Auto-approve"));

    expect(screen.getByLabelText("Auto-approve provider")).toBeTruthy();
    expect(screen.getByLabelText("Auto-approve model")).toBeTruthy();
  });
});
