// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledKick } from "@/lib/api";

// ── jsdom stubs ──
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── mock @/lib/api ──
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listScheduledKicks: vi.fn(),
      createScheduledKick: vi.fn(),
      updateScheduledKick: vi.fn(),
      deleteScheduledKick: vi.fn(),
      dryRunKick: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { ScheduledKicksSection, isValidCron, formatSchedule, formatRelative } = await import(
  "../ScheduledKicksSection"
);

const KICK_INTERVAL: ScheduledKick = {
  id: "morning-standup",
  schedule: { type: "interval", seconds: 3600 },
  prompt: "Run the daily standup protocol.",
  gating_predicate: "any_time",
  enabled: true,
  last_fire: null,
  next_fire: null,
};

const KICK_CRON: ScheduledKick = {
  id: "nightly-review",
  schedule: { type: "cron", expression: "0 22 * * 1-5" },
  prompt: "Review PRs and triage issues.",
  gating_predicate: "orchestrator_idle",
  enabled: false,
  last_fire: new Date(Date.now() - 86_400_000).toISOString(),
  next_fire: new Date(Date.now() + 3_600_000).toISOString(),
};

// ── unit tests for pure helpers ──

describe("isValidCron", () => {
  it("accepts standard 5-field expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 0 1 1 0")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidCron("")).toBe(false);
    expect(isValidCron("* * * *")).toBe(false); // 4 fields
    expect(isValidCron("* * * * * *")).toBe(false); // 6 fields
    expect(isValidCron("60 * * * *")).toBe(true); // range not validated, just format
  });
});

describe("formatSchedule", () => {
  it("formats interval in hours when divisible", () => {
    expect(formatSchedule({ type: "interval", seconds: 3600 })).toBe("every 1h");
    expect(formatSchedule({ type: "interval", seconds: 7200 })).toBe("every 2h");
  });

  it("formats interval in minutes when divisible", () => {
    expect(formatSchedule({ type: "interval", seconds: 300 })).toBe("every 5m");
  });

  it("formats interval in seconds otherwise", () => {
    expect(formatSchedule({ type: "interval", seconds: 90 })).toBe("every 90s");
  });

  it("returns expression as-is for cron type", () => {
    expect(formatSchedule({ type: "cron", expression: "0 9 * * 1-5" })).toBe("0 9 * * 1-5");
  });
});

describe("formatRelative", () => {
  it("formats past times as 'X ago'", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatRelative(twoHoursAgo)).toBe("2h ago");
  });

  it("formats future times as 'in X'", () => {
    const inFiveMinutes = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(formatRelative(inFiveMinutes)).toBe("in 5m");
  });
});

// ── component tests ──

describe("ScheduledKicksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.mocked(api.listScheduledKicks).mockReturnValue(new Promise(() => {}));
    render(<ScheduledKicksSection />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows empty state when no kicks are configured", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([]);
    render(<ScheduledKicksSection />);
    await waitFor(() => {
      expect(screen.getByText(/No routines configured/)).toBeTruthy();
    });
  });

  it("renders kicks list with id and schedule", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([KICK_INTERVAL, KICK_CRON]);
    render(<ScheduledKicksSection />);
    await waitFor(() => {
      expect(screen.getByText("morning-standup")).toBeTruthy();
      expect(screen.getByText("nightly-review")).toBeTruthy();
      expect(screen.getByText("every 1h")).toBeTruthy();
      expect(screen.getByText("0 22 * * 1-5")).toBeTruthy();
    });
  });

  it("opens new-kick form on '+ New Routine' click", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([]);
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("+ New Routine"));
    fireEvent.click(screen.getByText("+ New Routine"));
    expect(screen.getByPlaceholderText("morning-standup")).toBeTruthy();
  });

  it("shows cron validation indicator for invalid expression", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([]);
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("+ New Routine"));
    fireEvent.click(screen.getByText("+ New Routine"));

    // Switch to Cron tab
    fireEvent.click(screen.getByText("Cron"));

    const cronInput = screen.getByPlaceholderText("0 9 * * 1-5");
    fireEvent.change(cronInput, { target: { value: "bad-cron" } });

    // Should show invalid indicator
    await waitFor(() => {
      expect(screen.getByText("✗")).toBeTruthy();
    });
  });

  it("shows valid indicator for correct cron expression", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([]);
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("+ New Routine"));
    fireEvent.click(screen.getByText("+ New Routine"));

    fireEvent.click(screen.getByText("Cron"));

    const cronInput = screen.getByPlaceholderText("0 9 * * 1-5");
    fireEvent.change(cronInput, { target: { value: "0 9 * * 1-5" } });

    await waitFor(() => {
      expect(screen.getByText("✓")).toBeTruthy();
    });
  });

  it("shows delete confirmation before deleting", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([KICK_INTERVAL]);
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("morning-standup"));

    // Hover reveals buttons — simulate by querying directly
    const deleteBtn = screen.getByText("Delete");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText(/Delete routine/)).toBeTruthy();
    });
  });

  it("calls deleteScheduledKick when confirmed", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([KICK_INTERVAL]);
    vi.mocked(api.deleteScheduledKick).mockResolvedValue({ status: "deleted" });
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("morning-standup"));

    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => screen.getByText(/Delete routine/));

    // Click the confirm Delete button (inside confirmation panel)
    const confirmButtons = screen.getAllByText("Delete");
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(vi.mocked(api.deleteScheduledKick)).toHaveBeenCalledWith("morning-standup");
    });
  });

  it("shows error message when list fetch fails", async () => {
    vi.mocked(api.listScheduledKicks).mockRejectedValue(new Error("network error"));
    render(<ScheduledKicksSection />);
    await waitFor(() => {
      expect(screen.getByText("network error")).toBeTruthy();
    });
  });

  it("shows delete error inline when deleteScheduledKick fails", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([KICK_INTERVAL]);
    vi.mocked(api.deleteScheduledKick).mockRejectedValue(new Error("permission denied"));
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("morning-standup"));

    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => screen.getByText(/Delete routine/));

    const confirmButtons = screen.getAllByText("Delete");
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("permission denied")).toBeTruthy();
    });
  });

  it("shows dry-run result panel", async () => {
    vi.mocked(api.listScheduledKicks).mockResolvedValue([KICK_INTERVAL]);
    vi.mocked(api.dryRunKick).mockResolvedValue({
      rendered_prompt: "Run the daily standup protocol.",
      next_fire: null,
    });
    render(<ScheduledKicksSection />);
    await waitFor(() => screen.getByText("morning-standup"));

    fireEvent.click(screen.getByText("Dry Run"));

    // The rendered_prompt appears in a <pre> inside the dry-run panel.
    // The same text also appears truncated in the kick row, so we use getAllByText.
    await waitFor(() => {
      // Panel header contains kick id as a <code> sibling — match by full textContent
      const dryRunHeadings = screen.getAllByText((_: string, el: Element | null): boolean =>
        Boolean(
          el?.textContent?.includes("Dry Run") && el.textContent?.includes("morning-standup"),
        ),
      );
      expect(dryRunHeadings.length).toBeGreaterThan(0);
      // Prompt text appears in both kick row and pre — verify at least one occurrence
      const promptMatches = screen.getAllByText("Run the daily standup protocol.");
      expect(promptMatches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
