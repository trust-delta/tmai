// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DeveloperSection } from "../DeveloperSection";

const STORAGE_KEY = "tmai:dev-show-auto-discovered";

describe("DeveloperSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("toggle starts off when localStorage is empty", () => {
    render(<DeveloperSection />);
    const btn = screen.getByLabelText("Show auto-discovered agents");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the toggle persists to localStorage and flips aria-pressed", () => {
    render(<DeveloperSection />);
    const btn = screen.getByLabelText("Show auto-discovered agents");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("reads the existing localStorage value on mount", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    render(<DeveloperSection />);
    const btn = screen.getByLabelText("Show auto-discovered agents");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
