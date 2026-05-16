// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_PREFS_STORAGE_KEY } from "@/lib/ui-prefs";
import { renderWithProviders } from "@/test/render";
import { ThemeSection } from "../ThemeSection";

describe("ThemeSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows Tokyo Night selected by default, with Zinc and the Day theme available", () => {
    renderWithProviders(<ThemeSection />);
    // Exact-anchored so it doesn't also match "Tokyo Night Day".
    expect(screen.getByRole("button", { name: /^Tokyo Night$/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Zinc/ }).getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("button", { name: /Tokyo Night Day/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("persists a Zinc selection to the ui-prefs blob and reflects it", () => {
    renderWithProviders(<ThemeSection />);

    fireEvent.click(screen.getByRole("button", { name: /Zinc/ }));

    expect(screen.getByRole("button", { name: /Zinc/ }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").theme).toBe("zinc");
  });

  it("the migration landed: the light theme is selectable and persists", () => {
    renderWithProviders(<ThemeSection />);

    fireEvent.click(screen.getByRole("button", { name: /Tokyo Night Day/ }));

    expect(
      screen.getByRole("button", { name: /Tokyo Night Day/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").theme).toBe("light");
  });
});
