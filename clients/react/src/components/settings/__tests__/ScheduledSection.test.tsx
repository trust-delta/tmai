// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledSpawn } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getScheduledSettings: vi.fn(),
      updateScheduledSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { ScheduledSection, looksLikeValidCron } = await import("../ScheduledSection");

function makeEntry(overrides: Partial<ScheduledSpawn> = {}): ScheduledSpawn {
  return {
    name: "demo",
    cron: "0 * * * *",
    cwd: "/tmp/work",
    prompt: "do the thing",
    role: "implementer",
    vendor: null,
    model: null,
    effort: null,
    permission_mode: null,
    ...overrides,
  };
}

describe("looksLikeValidCron", () => {
  it("accepts the canonical 5-field form", () => {
    expect(looksLikeValidCron("0 * * * *")).toBe(true);
    expect(looksLikeValidCron("*/15 9-17 * * 1-5")).toBe(true);
  });

  it("accepts 6- and 7-field forms (server normalizes)", () => {
    expect(looksLikeValidCron("0 0 * * * *")).toBe(true);
    expect(looksLikeValidCron("0 0 0 * * * *")).toBe(true);
  });

  it("rejects free-form text and wrong field counts", () => {
    expect(looksLikeValidCron("every blue moon")).toBe(false);
    expect(looksLikeValidCron("0 * * *")).toBe(false);
    expect(looksLikeValidCron("")).toBe(false);
  });
});

describe("ScheduledSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while loading", () => {
    vi.mocked(api.getScheduledSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<ScheduledSection />);
    expect(container.firstChild).toBeNull();
  });

  it("renders empty state when no entries", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({ entries: [] });
    render(<ScheduledSection />);
    await waitFor(() => screen.getByText(/No scheduled entries/));
    expect(screen.getByText("+ New scheduled entry")).toBeTruthy();
  });

  it("lists existing entries with role badge + cron + cwd", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({
      entries: [
        makeEntry({ name: "hourly-pr-check", role: "orchestrator" }),
        makeEntry({
          name: "daily-cleanup",
          cron: "0 3 * * *",
          role: "manual",
          vendor: "claude",
        }),
      ],
    });
    render(<ScheduledSection />);
    await waitFor(() => screen.getByText("hourly-pr-check"));
    expect(screen.getByText("daily-cleanup")).toBeTruthy();
    // Both role badges render.
    expect(screen.getByText("orchestrator")).toBeTruthy();
    expect(screen.getByText("manual")).toBeTruthy();
    // Cron expressions are visible.
    expect(screen.getByText(/0 \* \* \* \*/)).toBeTruthy();
    expect(screen.getByText(/0 3 \* \* \*/)).toBeTruthy();
  });

  it("rejects manual role without vendor at form-submit time", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({ entries: [] });
    render(<ScheduledSection />);
    await waitFor(() => screen.getByText("+ New scheduled entry"));

    fireEvent.click(screen.getByText("+ New scheduled entry"));
    // Fill in the required text fields.
    const nameInput = screen.getByPlaceholderText("hourly-pr-check") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "test-manual" } });
    const cwdInput = screen.getByPlaceholderText("/home/me/works/tmai") as HTMLInputElement;
    fireEvent.change(cwdInput, { target: { value: "/tmp/work" } });
    const promptArea = screen.getByPlaceholderText(
      /Describe what the agent should do/,
    ) as HTMLTextAreaElement;
    fireEvent.change(promptArea, { target: { value: "do something" } });

    // Switch role to manual without picking a vendor.
    const roleSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "manual" } });

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => screen.getByText(/`vendor` is required when role is `manual`/));
    expect(vi.mocked(api.updateScheduledSettings)).not.toHaveBeenCalled();
  });

  it("on save, posts the full updated entry list", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({
      entries: [makeEntry({ name: "existing" })],
    });
    vi.mocked(api.updateScheduledSettings).mockResolvedValue({ ok: true, count: 2 });

    render(<ScheduledSection />);
    await waitFor(() => screen.getByText("existing"));

    fireEvent.click(screen.getByText("+ New scheduled entry"));
    fireEvent.change(screen.getByPlaceholderText("hourly-pr-check"), {
      target: { value: "added" },
    });
    fireEvent.change(screen.getByPlaceholderText("/home/me/works/tmai"), {
      target: { value: "/tmp/work" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what the agent should do/), {
      target: { value: "do something" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(vi.mocked(api.updateScheduledSettings)).toHaveBeenCalledWith({
        entries: [
          // Full prior list is sent through verbatim ...
          expect.objectContaining({ name: "existing" }),
          // ... with the new entry appended.
          expect.objectContaining({ name: "added", role: "implementer" }),
        ],
      }),
    );
  });

  it("surfaces server validation errors when PUT fails with structured payload", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({ entries: [] });
    // apiFetch surfaces the server payload as the error message.
    vi.mocked(api.updateScheduledSettings).mockRejectedValue(
      new Error(
        'API error 400: {"error":"scheduled entries failed validation","errors":[{"name":"x","reason":"`cron` failed to parse (`bad`): nope"}]}',
      ),
    );
    render(<ScheduledSection />);
    await waitFor(() => screen.getByText("+ New scheduled entry"));

    fireEvent.click(screen.getByText("+ New scheduled entry"));
    fireEvent.change(screen.getByPlaceholderText("hourly-pr-check"), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByPlaceholderText("/home/me/works/tmai"), {
      target: { value: "/tmp/work" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Describe what the agent should do/), {
      target: { value: "do something" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(screen.getByText(/x: `cron` failed to parse/)).toBeTruthy());
  });

  it("inline-deletes an entry after confirmation", async () => {
    vi.mocked(api.getScheduledSettings).mockResolvedValue({
      entries: [makeEntry({ name: "to-remove" })],
    });
    vi.mocked(api.updateScheduledSettings).mockResolvedValue({ ok: true, count: 0 });
    render(<ScheduledSection />);
    await waitFor(() => screen.getByText("to-remove"));

    fireEvent.click(screen.getByText("Delete"));
    // Confirmation panel renders.
    await waitFor(() => screen.getByText(/This cannot be undone/));
    // Click the "Delete" button on the confirmation. It's the second one now.
    const deleteButtons = screen.getAllByText("Delete");
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() =>
      expect(vi.mocked(api.updateScheduledSettings)).toHaveBeenCalledWith({ entries: [] }),
    );
  });
});
