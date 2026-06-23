import { describe, expect, it } from "vitest";
import { currentProjectBelongsToLiveProject } from "@/lib/current-project";

describe("currentProjectBelongsToLiveProject", () => {
  it("keeps an exact projectPaths member", () => {
    expect(currentProjectBelongsToLiveProject("/works/chm", ["/works/chm", "/works/tmai"])).toBe(
      true,
    );
  });

  it("keeps a multi-repo unit's PRIMARY repo when only the WRAPPER is a projectPath", () => {
    // The #581 dogfood bug: tmai's Producer runs at the wrapper `/works/tmai`
    // (the derived projectPath), but selecting tmai's tab sets currentProject
    // to its primary repo `/works/tmai/tmai` (a descendant). It must be kept,
    // not reset to projectPaths[0].
    expect(
      currentProjectBelongsToLiveProject("/works/tmai/tmai", [
        "/works/conversation-handoff-mcp",
        "/works/tmai",
      ]),
    ).toBe(true);
    // The secondary repo of the same unit is likewise in-tree.
    expect(currentProjectBelongsToLiveProject("/works/tmai/tmai-core", ["/works/tmai"])).toBe(true);
  });

  it("keeps a wrapper currentProject when a repo under it is the projectPath", () => {
    expect(currentProjectBelongsToLiveProject("/works/tmai", ["/works/tmai/tmai"])).toBe(true);
  });

  it("rejects a genuinely stale path with no live-project tree relationship", () => {
    expect(currentProjectBelongsToLiveProject("/works/old-gone", ["/works/tmai"])).toBe(false);
  });

  it("does not false-match a sibling that merely shares a name prefix", () => {
    // `/works/tmai-extra` is NOT in `/works/tmai`'s tree — the `/` boundary
    // must prevent the prefix from matching.
    expect(currentProjectBelongsToLiveProject("/works/tmai-extra", ["/works/tmai"])).toBe(false);
    expect(currentProjectBelongsToLiveProject("/works/tmai", ["/works/tmai-extra"])).toBe(false);
  });

  it("rejects against an empty project list", () => {
    expect(currentProjectBelongsToLiveProject("/works/tmai", [])).toBe(false);
  });
});
