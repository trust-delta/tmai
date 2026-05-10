import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <UIPrefsProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </UIPrefsProvider>
  );
}

// Test render helper that mounts the global UI providers (UIPrefsProvider,
// ConfirmProvider) so components depending on them can be exercised in
// isolation. Use this instead of `render` from @testing-library/react in any
// test that touches a component reading WebUI prefs or showing a confirm
// dialog.
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { wrapper: AllProviders, ...options });
}
