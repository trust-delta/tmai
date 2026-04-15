import { describe, expect, it } from "vitest";
import { buildNotifyEventHelp, formatModeLabel } from "../notify-event-help";

describe("formatModeLabel", () => {
  it("renders a human-readable label for each EventHandling value", () => {
    expect(formatModeLabel("off")).toMatch(/Off/);
    expect(formatModeLabel("notify")).toMatch(/Notify/);
    expect(formatModeLabel("auto_action")).toMatch(/Auto Action/);
  });
});

describe("buildNotifyEventHelp", () => {
  it("includes the label, default mode, and not-supported line when no auto-action", () => {
    const text = buildNotifyEventHelp({
      label: "Agent stopped",
      defaultMode: "notify",
    });
    expect(text).toContain("Agent stopped");
    expect(text).toContain("Default: Notify");
    expect(text).toContain("Auto Action: not supported");
  });

  it("shows the auto-action behavior when supported", () => {
    const text = buildNotifyEventHelp({
      label: "CI failed",
      defaultMode: "notify",
      autoActionBehavior: "Instruct the implementer to fix the failure.",
      hasTemplate: true,
    });
    expect(text).toContain("Auto Action: Instruct the implementer to fix the failure.");
    expect(text).toContain('Select Auto and click "template"');
  });

  it("omits the template hint when the event has no editable template", () => {
    const text = buildNotifyEventHelp({
      label: "CI passed",
      defaultMode: "off",
      autoActionBehavior: "Dispatch a reviewer when no review is present.",
      hasTemplate: false,
    });
    expect(text).toContain("Auto Action: Dispatch a reviewer when no review is present.");
    expect(text).not.toContain("template");
  });

  it("reflects 'off' as the default for events that default to silent", () => {
    const text = buildNotifyEventHelp({
      label: "CI passed",
      defaultMode: "off",
    });
    expect(text).toContain("Default: Off");
  });
});
