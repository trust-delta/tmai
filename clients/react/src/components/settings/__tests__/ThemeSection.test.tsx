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

  it("shows Tokyo Night selected by default", () => {
    renderWithProviders(<ThemeSection />);
    expect(screen.getByRole("button", { name: /Tokyo Night/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Zinc/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("persists the selection to the ui-prefs blob and reflects it", () => {
    renderWithProviders(<ThemeSection />);

    fireEvent.click(screen.getByRole("button", { name: /Zinc/ }));

    expect(screen.getByRole("button", { name: /Zinc/ }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").theme).toBe("zinc");
  });
});
