// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_PREFS_STORAGE_KEY } from "@/lib/ui-prefs";
import { renderWithProviders } from "@/test/render";
import { DisplayLayoutSection } from "../DisplayLayoutSection";

describe("DisplayLayoutSection — terminal font size", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the default size and increments it, persisting to ui-prefs", () => {
    renderWithProviders(<DisplayLayoutSection />);

    expect(screen.getByText("13 px")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Increase terminal text size"));

    expect(screen.getByText("14 px")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").terminalFontSize).toBe(
      14,
    );
  });

  it("disables the − button at the minimum size", () => {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ terminalFontSize: 8 }));
    renderWithProviders(<DisplayLayoutSection />);

    const dec = screen.getByLabelText("Decrease terminal text size") as HTMLButtonElement;
    expect(dec.disabled).toBe(true);
  });
});
