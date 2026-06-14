import { describe, expect, it } from "vitest";
import { type AimBodySection, hasStructure, parseAimBody } from "../aim-body-parse";

const kinds = (s: AimBodySection[]) => s.map((x) => x.kind);

describe("parseAimBody", () => {
  it("splits a real drift-git-shaped body into means + dag sections", () => {
    const body = [
      "# 手段",
      "",
      "drift 表面化機構（means・未実装）",
      "",
      "- 入力はローカル git の行レベル履歴",
      "- within-node: aim 行 ts vs body ts",
      "",
      "# DAG",
      "",
      "- 依存: [[git-local-fact-source]]",
    ].join("\n");
    const sections = parseAimBody(body);
    expect(kinds(sections)).toEqual(["means", "dag"]);
    expect(sections[0].heading).toBe("手段");
    expect(sections[0].content).toContain("drift 表面化機構");
    expect(sections[1].content).toContain("[[git-local-fact-source]]");
  });

  it("classifies obstacle / history / english headings", () => {
    const body = ["# 障害", "blocked on X", "# history", "rejected Y", "## Means", "do Z"].join(
      "\n",
    );
    expect(kinds(parseAimBody(body))).toEqual(["obstacle", "history", "means"]);
  });

  it("keeps a lead block before the first heading as a prose section", () => {
    const sections = parseAimBody("intro line\n\n# 手段\n- a");
    expect(sections[0]).toMatchObject({ kind: "prose", heading: "" });
    expect(sections[0].content).toBe("intro line");
    expect(sections[1].kind).toBe("means");
  });

  it("drops an empty lead block but keeps an empty headed slot", () => {
    const sections = parseAimBody("\n\n# 手段\n");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ kind: "means", content: "" });
  });

  it("returns nothing for an empty body", () => {
    expect(parseAimBody("   \n  ")).toEqual([]);
  });

  it("hasStructure is true only with a recognised section", () => {
    expect(hasStructure(parseAimBody("# 手段\n- a"))).toBe(true);
    expect(hasStructure(parseAimBody("just prose, no headings"))).toBe(false);
    expect(hasStructure(parseAimBody("# 雑記\nfree notes"))).toBe(false);
  });
});
