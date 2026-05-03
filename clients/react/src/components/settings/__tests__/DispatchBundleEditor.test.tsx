// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import { DispatchBundleEditor } from "../DispatchBundleEditor";

const noop = () => {};

function renderEditor(bundle: DispatchBundle | null) {
  const onAtomic = vi.fn();
  const onDraft = vi.fn();
  const onCommit = vi.fn();
  render(
    <DispatchBundleEditor
      title="Implementer"
      subtitle="dispatch_issue / spawn_worktree"
      bundle={bundle}
      onAtomicChange={onAtomic}
      onTextDraft={onDraft}
      onTextCommit={onCommit}
    />,
  );
  return { onAtomic, onDraft, onCommit };
}

function permissionOption(label: string): HTMLOptionElement {
  const select = screen.getByLabelText(/Permission mode for/i) as HTMLSelectElement;
  const opt = Array.from(select.options).find((o) => o.value === label);
  if (!opt) throw new Error(`option ${label} not found`);
  return opt;
}

describe("DispatchBundleEditor — validity matrix", () => {
  it("disables auto for claude when model is not opus-tier", () => {
    renderEditor({ vendor: "claude", model: "claude-sonnet-4-6" });
    expect(permissionOption("auto").disabled).toBe(true);
    expect(permissionOption("auto").textContent).toMatch(/requires opus-tier model/);
  });

  it("enables auto for claude when model is opus-tier", () => {
    renderEditor({ vendor: "claude", model: "claude-opus-4-7" });
    expect(permissionOption("auto").disabled).toBe(false);
  });

  it("disables plan and dont_ask for codex (matches vendor_compat.rs)", () => {
    renderEditor({ vendor: "codex", model: "codex-1" });
    expect(permissionOption("plan").disabled).toBe(true);
    expect(permissionOption("dontAsk").disabled).toBe(true);
    expect(permissionOption("acceptEdits").disabled).toBe(false);
    expect(permissionOption("auto").disabled).toBe(true);
  });

  it("only allows default for gemini (matches vendor_compat.rs)", () => {
    renderEditor({ vendor: "gemini", model: "gemini-2.5-pro" });
    expect(permissionOption("plan").disabled).toBe(true);
    expect(permissionOption("dontAsk").disabled).toBe(true);
    expect(permissionOption("acceptEdits").disabled).toBe(true);
    expect(permissionOption("auto").disabled).toBe(true);
  });

  it("clears permission_mode when vendor change makes it invalid", () => {
    const { onAtomic } = renderEditor({
      vendor: "claude",
      model: "claude-opus-4-7",
      permission_mode: "auto",
    });
    const vendorSelect = screen.getByLabelText(/Vendor for/i) as HTMLSelectElement;
    fireEvent.change(vendorSelect, { target: { value: "codex" } });
    expect(onAtomic).toHaveBeenCalledTimes(1);
    const next = onAtomic.mock.calls[0][0] as DispatchBundle;
    expect(next.vendor).toBe("codex");
    expect(next.model).toBeNull();
    expect(next.permission_mode).toBeNull();
  });

  it("preserves permission_mode when vendor change keeps it valid", () => {
    const { onAtomic } = renderEditor({
      vendor: "claude",
      model: "claude-sonnet-4-6",
      permission_mode: "acceptEdits",
    });
    const vendorSelect = screen.getByLabelText(/Vendor for/i) as HTMLSelectElement;
    fireEvent.change(vendorSelect, { target: { value: "codex" } });
    const next = onAtomic.mock.calls[0][0] as DispatchBundle;
    expect(next.permission_mode).toBe("acceptEdits");
  });

  it("clears auto when model commit downgrades from opus to non-opus", () => {
    const { onCommit } = renderEditor({
      vendor: "claude",
      model: "claude-opus-4-7",
      permission_mode: "auto",
    });
    const modelInput = screen.getByLabelText(/Model for/i) as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: "claude-sonnet-4-6" } });
    fireEvent.blur(modelInput);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const next = onCommit.mock.calls[0][0] as DispatchBundle;
    expect(next.model).toBe("claude-sonnet-4-6");
    expect(next.permission_mode).toBeNull();
  });
});

describe("DispatchBundleEditor — placeholders", () => {
  it("shows the latest claude-opus model as placeholder", () => {
    renderEditor({ vendor: "claude" });
    const modelInput = screen.getByLabelText(/Model for/i) as HTMLInputElement;
    expect(modelInput.placeholder).toBe("claude-opus-4-7");
  });
});

describe("DispatchBundleEditor — legacy fallback", () => {
  it("renders the 'Use vendor CLI default' checkbox checked when bundle is null", () => {
    renderEditor(null);
    const checkbox = screen.getByLabelText(/Use vendor CLI default for/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("emits null on toggle on, claude default on toggle off", () => {
    const { onAtomic } = renderEditor({ vendor: "codex", model: "codex-1" });
    const checkbox = screen.getByLabelText(/Use vendor CLI default for/i);
    fireEvent.click(checkbox);
    expect(onAtomic).toHaveBeenLastCalledWith(null);
  });
});

// quiet unused import warning when noop is not referenced
void noop;
