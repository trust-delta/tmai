// @vitest-environment jsdom
//
// ProducerLaunchPicker — the aim-console "add unit = launch a Producer" path.
// The picker reuses DirBrowser; on "Launch Producer here" it forwards the
// browsed repo root to `onLaunchProducerAt` (App's `launchProducerAt`, the
// existing /api/spawn launch — no new endpoint, #788) and closes.
//
// `api.getGeneralSettings` (start-dir default) and `api.listDirectories`
// (DirBrowser's tree) are mocked so the picker never hits the network.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/api";
import { ProducerLaunchPicker } from "../ProducerLaunchPicker";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getGeneralSettings: vi.fn(async () => ({ default_project_root: "/home/u" })),
      listDirectories: vi.fn(
        async (_path?: string): Promise<DirEntry[]> => [
          { path: "/home/u/proj", name: "proj", is_git: true },
        ],
      ),
    },
  };
});

describe("ProducerLaunchPicker", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProducerLaunchPicker open={false} onClose={vi.fn()} onLaunchProducerAt={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("launches a Producer at the browsed repo root and closes", async () => {
    const onClose = vi.fn();
    const onLaunchProducerAt = vi.fn();
    render(<ProducerLaunchPicker open onClose={onClose} onLaunchProducerAt={onLaunchProducerAt} />);

    // DirBrowser loads the default root → currentPath is set → the
    // "Launch Producer here" action enables.
    const launchBtn = (await screen.findByRole("button", {
      name: /Launch Producer here/,
    })) as HTMLButtonElement;
    await waitFor(() => expect(launchBtn.disabled).toBe(false));

    fireEvent.click(launchBtn);
    expect(onLaunchProducerAt).toHaveBeenCalledWith("/home/u");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
