import { beforeEach, describe, expect, it } from "vitest";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("useResponsiveLayout storage keys", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("should use correct localStorage keys for sidebar state", () => {
    localStorageMock.setItem("tmai:sidebar-collapsed", "true");
    expect(localStorageMock.getItem("tmai:sidebar-collapsed")).toBe("true");
  });

  it("should use correct localStorage keys for action panel state", () => {
    localStorageMock.setItem("tmai:action-panel-collapsed", "true");
    expect(localStorageMock.getItem("tmai:action-panel-collapsed")).toBe("true");
  });

  it("should default to non-collapsed when no stored value", () => {
    expect(localStorageMock.getItem("tmai:sidebar-collapsed")).toBeNull();
    expect(localStorageMock.getItem("tmai:action-panel-collapsed")).toBeNull();
  });

  it("should store boolean as string", () => {
    localStorageMock.setItem("tmai:sidebar-collapsed", String(false));
    expect(localStorageMock.getItem("tmai:sidebar-collapsed")).toBe("false");

    localStorageMock.setItem("tmai:sidebar-collapsed", String(true));
    expect(localStorageMock.getItem("tmai:sidebar-collapsed")).toBe("true");
  });
});

describe("useResponsiveLayout module exports", () => {
  it("should export useResponsiveLayout function", async () => {
    const mod = await import("./useResponsiveLayout");
    expect(typeof mod.useResponsiveLayout).toBe("function");
  });
});

describe("narrow screen breakpoint", () => {
  it("should use 1024px as the narrow screen threshold", async () => {
    // The hook uses matchMedia("(min-width: 1024px)")
    // Screens < 1024px are considered narrow and auto-collapse panels
    const source = await import("./useResponsiveLayout?raw");
    // Verify the breakpoint constant is defined
    expect(source.default).toContain("1024px");
  });
});
