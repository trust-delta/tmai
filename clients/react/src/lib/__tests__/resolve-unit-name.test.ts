// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SlotResponse } from "@/types/generated/SlotResponse";
import { resolveUnitName } from "../api-http";

// The real multi-repo unit at the heart of the aim-console worker-
// invisibility bug: the Producer runs at the wrapper `…/tmai`, the unit
// "tmai" spans a primary repo (`…/tmai/tmai`, basename matches the unit name)
// and a SECONDARY repo (`…/tmai/tmai-core`, basename "tmai-core" does NOT).
const TMAI_UNIT: SlotResponse = {
  name: "tmai",
  repos: [
    { path: "/home/u/works/tmai/tmai", primary: true },
    { path: "/home/u/works/tmai/tmai-core", primary: false },
  ],
};

describe("resolveUnitName", () => {
  it("returns null for a null currentProject", () => {
    expect(resolveUnitName(null, [TMAI_UNIT])).toBeNull();
  });

  // The regression: a worktree worker's git_common_dir lands `currentProject`
  // on the SECONDARY repo. A basename derivation would yield "tmai-core",
  // mismatching every agent's wire `unit` ("tmai") and emptying the
  // SessionPane. Membership resolution returns the OWNING unit instead.
  it("resolves a SECONDARY repo path to the owning unit name (the bug)", () => {
    expect(resolveUnitName("/home/u/works/tmai/tmai-core", [TMAI_UNIT])).toBe("tmai");
  });

  it("resolves the primary repo path to the unit name", () => {
    expect(resolveUnitName("/home/u/works/tmai/tmai", [TMAI_UNIT])).toBe("tmai");
  });

  it("resolves the wrapper dir (which contains the repos) to the unit name", () => {
    expect(resolveUnitName("/home/u/works/tmai", [TMAI_UNIT])).toBe("tmai");
  });

  it("resolves a path INSIDE a repo (a worktree cwd) to the owning unit", () => {
    expect(
      resolveUnitName("/home/u/works/tmai/tmai-core/.claude/worktrees/probe", [TMAI_UNIT]),
    ).toBe("tmai");
  });

  it("normalizes a trailing /.git and slashes before matching", () => {
    expect(resolveUnitName("/home/u/works/tmai/tmai-core/.git", [TMAI_UNIT])).toBe("tmai");
    expect(resolveUnitName("/home/u/works/tmai/tmai-core///", [TMAI_UNIT])).toBe("tmai");
  });

  it("falls back to the path basename when no configured unit matches", () => {
    expect(resolveUnitName("/home/u/works/other-proj", [TMAI_UNIT])).toBe("other-proj");
  });

  it("falls back to the basename when the units list is empty (cwd-synthesized unit)", () => {
    expect(resolveUnitName("/home/u/works/standalone", [])).toBe("standalone");
  });

  it("does not match a sibling repo that merely shares a path prefix", () => {
    // `…/tmai-core-extra` must NOT match the `…/tmai-core` repo — the boundary
    // check is on a full path segment (`norm === repo` or a `/`-delimited
    // prefix), not a bare string prefix.
    const units: SlotResponse[] = [
      { name: "tmai", repos: [{ path: "/home/u/works/tmai/tmai-core", primary: true }] },
    ];
    expect(resolveUnitName("/home/u/works/tmai/tmai-core-extra", units)).toBe("tmai-core-extra");
  });
});
