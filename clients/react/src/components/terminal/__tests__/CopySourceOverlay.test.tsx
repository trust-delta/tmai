// @vitest-environment jsdom
//
// Copy-source button for fenced code blocks (#819) — the acceptance bar is
// FIDELITY: clicking copy must yield the logical source byte-exact (the
// soft-wrap newlines the grid rendering introduces must not be copied, and
// no `\r`), and the button must not exist over non-fenced text.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FenceScanTerminal } from "@/hooks/useFencedCodeBlocks";
import { makeBuffer } from "@/test/fake-xterm";
import { CopySourceOverlay } from "../CopySourceOverlay";

const writeText = vi.fn<(s: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeTerminal(logicalLines: string[], cols: number): FenceScanTerminal {
  return {
    cols,
    buffer: { active: makeBuffer(logicalLines, cols) },
    onWriteParsed: () => ({ dispose: () => {} }),
    onResize: () => ({ dispose: () => {} }),
  };
}

function renderOverlay(logicalLines: string[], cols: number) {
  const term = fakeTerminal(logicalLines, cols);
  return render(<CopySourceOverlay terminalRef={{ current: term }} agentId="claude:a1" />);
}

describe("CopySourceOverlay", () => {
  it("renders no button when the buffer has no fenced block", () => {
    renderOverlay(["⏺ plain conversation, nothing fenced", "$ prompt"], 30);
    expect(screen.queryByTestId("copy-code-source")).toBeNull();
  });

  it("copies the EXACT source of a block whose rendering soft-wraps", async () => {
    const cmd =
      "gh api repos/owner/repo/branches/main/protection --method PUT --input protection.json";
    // cols=24 forces the command across 4 grid rows — the incident shape.
    renderOverlay(["⏺ Run this:", "```bash", cmd, "git push", "```"], 24);

    fireEvent.click(screen.getByTestId("copy-code-source"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${cmd}\ngit push`);
    await waitFor(() => {
      expect(screen.getByTestId("copy-code-source").textContent).toContain("Copied");
    });
  });

  it("guarantees the copied string carries no \\r", () => {
    renderOverlay(["```", "foo\rbar", "```"], 80);
    fireEvent.click(screen.getByTestId("copy-code-source"));
    const copied = writeText.mock.calls[0][0];
    expect(copied).not.toMatch(/\r/);
  });

  it("does not surface an unterminated (still-streaming) block", () => {
    renderOverlay(["```bash", "half a command"], 80);
    expect(screen.queryByTestId("copy-code-source")).toBeNull();
  });

  it("with several blocks, opens a list and copies the chosen block", () => {
    renderOverlay(["```", "first block", "```", "```", "second block", "```"], 80);

    const button = screen.getByTestId("copy-code-source");
    expect(button.textContent).toContain("(2)");
    fireEvent.click(button);
    // latest first — the freshest hand-over is the incident case
    const entries = screen.getAllByText(/block$/);
    expect(entries[0].textContent).toBe("second block");
    fireEvent.click(entries[0]);
    expect(writeText).toHaveBeenCalledWith("second block");
  });
});
