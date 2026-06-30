// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_PREFS_STORAGE_KEY } from "@/lib/ui-prefs";
import { renderWithProviders } from "@/test/render";
import { ThemeSection } from "../ThemeSection";

function storedMode(): string | undefined {
  return JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").themeMode;
}

describe("ThemeSection — System / Light / Dark mode picker", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers exactly System / Light / Dark, with System selected by default", () => {
    renderWithProviders(<ThemeSection />);
    expect(screen.getByRole("button", { name: /System/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /^Light$/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: /^Dark$/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("persists a Dark selection to the ui-prefs blob and reflects it", () => {
    renderWithProviders(<ThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Dark$/ }));
    expect(screen.getByRole("button", { name: /^Dark$/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(storedMode()).toBe("dark");
  });

  it("persists a Light selection", () => {
    renderWithProviders(<ThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Light$/ }));
    expect(screen.getByRole("button", { name: /^Light$/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(storedMode()).toBe("light");
  });

  it("can return to System (follow the OS)", () => {
    renderWithProviders(<ThemeSection />);
    fireEvent.click(screen.getByRole("button", { name: /^Dark$/ }));
    fireEvent.click(screen.getByRole("button", { name: /System/ }));
    expect(screen.getByRole("button", { name: /System/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(storedMode()).toBe("system");
  });
});
