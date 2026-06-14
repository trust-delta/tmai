import { describe, expect, it } from "vitest";
import { type AimBodySection, hasStructure, parseAimBody, parseMeans } from "../aim-body-parse";

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

  it("classifies is / obstacle / history / english headings", () => {
    const body = [
      "# is — 前提",
      "premise",
      "# 障害",
      "blocked on X",
      "# history",
      "rejected Y",
      "## Means",
      "do Z",
    ].join("\n");
    expect(kinds(parseAimBody(body))).toEqual(["is", "obstacle", "history", "means"]);
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

describe("parseMeans", () => {
  it("parses status markers into a done/todo checklist with detail", () => {
    const content = [
      "drift 表面化機構",
      "",
      "- [未実装] within-node: aim 行 ts vs body ts",
      "    - strict > 比較",
      "- [実装済] 既存 parser split_frontmatter",
    ].join("\n");
    const m = parseMeans(content);
    expect(m.intro).toBe("drift 表面化機構");
    expect(m.items).toHaveLength(2);
    expect(m.items[0]).toMatchObject({ status: "todo", text: "within-node: aim 行 ts vs body ts" });
    expect(m.items[0].detail).toContain("strict >");
    expect(m.items[1]).toMatchObject({ status: "done", text: "既存 parser split_frontmatter" });
    expect(m.done).toBe(1);
    expect(m.todo).toBe(1);
  });

  it("treats unmarked bullets as status-less items (no false checkboxes)", () => {
    const m = parseMeans("- 作成 modal は bearing のみ\n- 純 ought の誕生も正規");
    expect(m.items.map((i) => i.status)).toEqual([null, null]);
    expect(m.done).toBe(0);
    expect(m.todo).toBe(0);
  });

  it("accepts english done/todo markers", () => {
    const m = parseMeans("- [done] a\n- [todo] b\n- [x] c");
    expect(m.items.map((i) => i.status)).toEqual(["done", "todo", "done"]);
  });
});
