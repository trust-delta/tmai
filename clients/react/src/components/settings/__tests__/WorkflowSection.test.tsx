// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getWorkflowSettings: vi.fn(),
      updateWorkflowSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { WorkflowSection } = await import("../WorkflowSection");

function makeSettings(overrides: Partial<WorkflowSettings> = {}): WorkflowSettings {
  return { auto_rebase_on_merge: false, ...overrides };
}

describe("WorkflowSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while loading", () => {
    vi.mocked(api.getWorkflowSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<WorkflowSection />);
    expect(container.firstChild).toBeNull();
  });

  it("toggling auto-rebase persists and rolls back on error", async () => {
    vi.mocked(api.getWorkflowSettings).mockResolvedValue(
      makeSettings({ auto_rebase_on_merge: false }),
    );
    vi.mocked(api.updateWorkflowSettings).mockRejectedValue(new Error("nope"));
    render(<WorkflowSection />);
    await waitFor(() => screen.getByText("Workflow"));

    const toggle = screen.getByLabelText("Auto-rebase on merge");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(vi.mocked(api.updateWorkflowSettings)).toHaveBeenCalledWith({
        auto_rebase_on_merge: true,
      });
      expect(screen.getByText(/nope/)).toBeTruthy();
    });
  });
});
