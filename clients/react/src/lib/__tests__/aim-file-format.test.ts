import { describe, expect, it } from "vitest";
import {
  editAimFrontmatter,
  fileToAimWire,
  serializeNewAim,
  splitFrontmatter,
  unquoteYamlScalar,
  validateAimSlug,
  yamlInlineScalar,
} from "../aim-file-format";

describe("splitFrontmatter", () => {
  it("splits leading frontmatter from the body", () => {
    const r = splitFrontmatter("---\naim: x\nstate: open\n---\n\n# IS\n\nbody.\n");
    expect(r).not.toBeNull();
    expect(r?.front).toBe("aim: x\nstate: open");
    expect(r?.body).toBe("\n# IS\n\nbody.\n");
  });

  it("handles CRLF endings (mirror of the Rust — the pre-close CR stays in front, frontLines strips it)", () => {
    const r = splitFrontmatter("---\r\naim: x\r\nstate: open\r\n---\r\nbody\r\n");
    expect(r?.front).toBe("aim: x\r\nstate: open\r");
    expect(r?.body).toBe("body\r\n");
    // downstream: fileToAimWire normalizes the CR away
    const w = fileToAimWire("x", "---\r\naim: hi\r\nstate: open\r\n---\r\nbody\r\n");
    expect(w.aim).toBe("hi");
    expect(w.state).toBe("open");
  });

  it("returns null for a file with no frontmatter", () => {
    expect(splitFrontmatter("# just a markdown file\n")).toBeNull();
    expect(splitFrontmatter("---\naim: unterminated\n")).toBeNull();
  });
});

describe("yaml scalar round-trip", () => {
  const cases = [
    "tmai はバイブコーディングの個人開発を支援する",
    "unit を組んでいれば同じ権限で動いて然るべき",
    "a value: with a colon",
    "has \"double\" and 'single' quotes",
    "- leading dash looks like a sequence",
    "trailing colon:",
    "true",
    "42",
    "café — em dash and unicode ✓",
    "#hash-leading",
  ];
  for (const v of cases) {
    it(`round-trips ${JSON.stringify(v)}`, () => {
      expect(unquoteYamlScalar(yamlInlineScalar(v))).toBe(v);
    });
  }

  it("emits a plain scalar for a safe value (corpus style)", () => {
    expect(yamlInlineScalar("a plain anchor sentence")).toBe("a plain anchor sentence");
  });

  it("double-quotes a value carrying a colon", () => {
    expect(yamlInlineScalar("a: b")).toBe('"a: b"');
  });

  it("reads the engine's single-quoted output", () => {
    expect(unquoteYamlScalar("'it''s quoted'")).toBe("it's quoted");
  });
});

describe("fileToAimWire", () => {
  it("parses a root node", () => {
    const w = fileToAimWire(
      "aim-system",
      "---\naim: the root bearing\nstate: open\n---\n\n# IS\n\nx\n",
    );
    expect(w.slug).toBe("aim-system");
    expect(w.aim).toBe("the root bearing");
    expect(w.parent).toBeNull();
    expect(w.state).toBe("open");
    expect(w.body).toBe("\n# IS\n\nx\n");
    expect(w.drift).toBeNull();
    expect(w.working_delta).toBeNull();
  });

  it("parses a child node with a quoted anchor and a parent", () => {
    const w = fileToAimWire(
      "drift-git",
      '---\naim: "drift: a colon anchor"\nparent: new-aim\nstate: done\n---\nbody\n',
    );
    expect(w.aim).toBe("drift: a colon anchor");
    expect(w.parent).toBe("new-aim");
    expect(w.state).toBe("done");
  });

  it("ignores look-alike keys and preserves the body", () => {
    const w = fileToAimWire("x", "---\naim: real\naim_note: not a key\nstate: dead\n---\nB\n");
    expect(w.aim).toBe("real");
    expect(w.state).toBe("dead");
  });

  it("throws on a missing anchor or state", () => {
    expect(() => fileToAimWire("x", "---\nstate: open\n---\n")).toThrow(/aim:/);
    expect(() => fileToAimWire("x", "---\naim: y\n---\n")).toThrow(/state/);
    expect(() => fileToAimWire("x", "no frontmatter")).toThrow(/frontmatter/);
  });
});

describe("serializeNewAim", () => {
  it("emits a frontmatter-only root, no parent line", () => {
    expect(serializeNewAim("hello", null, "open")).toBe("---\naim: hello\nstate: open\n---\n");
  });

  it("emits parent between aim and state when present", () => {
    expect(serializeNewAim("child goal", "parent-slug", "open")).toBe(
      "---\naim: child goal\nparent: parent-slug\nstate: open\n---\n",
    );
  });

  it("round-trips through the parser", () => {
    const raw = serializeNewAim("a: colon anchor", "p", "done");
    const w = fileToAimWire("s", raw);
    expect(w.aim).toBe("a: colon anchor");
    expect(w.parent).toBe("p");
    expect(w.state).toBe("done");
    expect(w.body).toBe("");
  });
});

describe("editAimFrontmatter", () => {
  const record = [
    "---",
    "aim: old anchor",
    "parent: old-parent",
    "depends_on: [a, b]",
    "state: open",
    "---",
    "",
    "# IS",
    "",
    "the body is preserved.",
    "",
  ].join("\n");

  it("rewrites only aim/parent/state, preserving cross-edges and body byte-for-byte", () => {
    const out = editAimFrontmatter(record, "new anchor", "new-parent", "done");
    expect(out).toBe(
      [
        "---",
        "aim: new anchor",
        "parent: new-parent",
        "depends_on: [a, b]",
        "state: done",
        "---",
        "",
        "# IS",
        "",
        "the body is preserved.",
        "",
      ].join("\n"),
    );
  });

  it("re-roots by dropping the parent line when parent is null", () => {
    const out = editAimFrontmatter(record, "old anchor", null, "open");
    expect(out).not.toContain("parent:");
    expect(out).toContain("depends_on: [a, b]");
    expect(out).toContain("the body is preserved.");
  });

  it("inserts a new parent line right after aim when none existed", () => {
    const rootRecord = "---\naim: a root\nstate: open\n---\nBODY\n";
    const out = editAimFrontmatter(rootRecord, "a root", "now-a-child", "open");
    expect(out).toBe("---\naim: a root\nparent: now-a-child\nstate: open\n---\nBODY\n");
  });

  it("preserves the body exactly across an edit", () => {
    const out = editAimFrontmatter(record, "x", "old-parent", "open");
    const body = splitFrontmatter(out)?.body;
    expect(body).toBe("\n# IS\n\nthe body is preserved.\n");
  });
});

describe("validateAimSlug", () => {
  it("accepts a valid kebab slug", () => {
    expect(validateAimSlug("aim-system")).toBeNull();
    expect(validateAimSlug("drift-git")).toBeNull();
  });

  it("rejects empty / uppercase / bad dashes / dated slugs", () => {
    expect(validateAimSlug("")).toMatch(/empty/);
    expect(validateAimSlug("Aim-System")).toMatch(/kebab/);
    expect(validateAimSlug("under_score")).toMatch(/kebab/);
    expect(validateAimSlug("-leading")).toMatch(/start\/end/);
    expect(validateAimSlug("double--dash")).toMatch(/start\/end/);
    expect(validateAimSlug("2026-06-15-dated")).toMatch(/NON-dated/);
  });
});
