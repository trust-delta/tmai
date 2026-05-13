// @vitest-environment jsdom
//
// StatusBar — focused on the dashboard-return affordance added in
// response to dogfood feedback 2026-05-14 ("Producer 会話中に dashboard
// に戻る経路がない"). The other StatusBar slots (agent count,
// attention pill, indicator slot, security / settings buttons) are
// covered by integration tests via App.tsx; here we only assert the
// new return-to-console button's presence / absence across the
// desktop, collapsed-sidebar, and mobile variants.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusBar } from "../StatusBar";

describe("StatusBar — return-to-console button", () => {
  describe("desktop variant", () => {
    it("omits the button when onReturnToConsole is undefined", () => {
      render(
        <StatusBar
          agentCount={0}
          attentionCount={0}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: /Return to Producer console/ })).toBeNull();
    });

    it("renders the button when onReturnToConsole is defined and fires it on click", () => {
      const onReturn = vi.fn();
      render(
        <StatusBar
          agentCount={1}
          attentionCount={0}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
          onReturnToConsole={onReturn}
        />,
      );

      const button = screen.getByRole("button", { name: /Return to Producer console/ });
      fireEvent.click(button);
      expect(onReturn).toHaveBeenCalledTimes(1);
    });
  });

  describe("collapsed-sidebar variant", () => {
    it("omits the button when onReturnToConsole is undefined", () => {
      render(
        <StatusBar
          agentCount={0}
          attentionCount={0}
          collapsed
          onToggleCollapse={vi.fn()}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: /Return to Producer console/ })).toBeNull();
    });

    it("renders the button when onReturnToConsole is defined and fires it on click", () => {
      const onReturn = vi.fn();
      render(
        <StatusBar
          agentCount={0}
          attentionCount={0}
          collapsed
          onToggleCollapse={vi.fn()}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
          onReturnToConsole={onReturn}
        />,
      );

      const button = screen.getByRole("button", { name: /Return to Producer console/ });
      fireEvent.click(button);
      expect(onReturn).toHaveBeenCalledTimes(1);
    });
  });

  describe("mobile variant", () => {
    it("omits the button when onReturnToConsole is undefined", () => {
      render(
        <StatusBar
          agentCount={0}
          attentionCount={0}
          isMobile
          onMobileMenuClick={vi.fn()}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: /Return to Producer console/ })).toBeNull();
    });

    it("renders the button when onReturnToConsole is defined and fires it on click", () => {
      const onReturn = vi.fn();
      render(
        <StatusBar
          agentCount={0}
          attentionCount={0}
          isMobile
          onMobileMenuClick={vi.fn()}
          onSettingsClick={vi.fn()}
          onSecurityClick={vi.fn()}
          onReturnToConsole={onReturn}
        />,
      );

      const button = screen.getByRole("button", { name: /Return to Producer console/ });
      fireEvent.click(button);
      expect(onReturn).toHaveBeenCalledTimes(1);
    });
  });
});
