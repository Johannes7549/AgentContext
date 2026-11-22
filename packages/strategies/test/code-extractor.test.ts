import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeExtractor } from "../src/index.js";
import { makeAnalysis, makeContext, recover, run } from "./helpers/context.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const code = fixture("module.ts");
const diff = fixture("change.diff");

describe("code-extractor — line ranges", () => {
  it("does nothing to plain code without a selection (R5)", async () => {
    const { estimate, output } = await run(codeExtractor, code, "code");
    expect(estimate.applicable).toBe(false);
    expect(estimate.reason).toContain("requires selection.lines");
    expect(output.content).toBe(code);
  });

  it("keeps requested ranges with context and original line numbers", async () => {
    const { output, issues } = await run(codeExtractor, code, "code", {
      selection: {
        lines: {
          ranges: [
            { start: 10, end: 11 },
            { start: 30, end: 30 },
          ],
          context: 1,
        },
      },
    });
    expect(issues).toEqual([]);
    expect(output.content.split("\n")).toEqual([
      "[... s1: 8 lines omitted (lines 1-8)]",
      " 9 | function f9() { return 9; }",
      "10 | function f10() { return 10; }",
      "11 | function f11() { return 11; }",
      "12 | function f12() { return 12; }",
      "[... s2: 16 lines omitted (lines 13-28)]",
      "29 | function f29() { return 29; }",
      "30 | function f30() { return 30; }",
      "31 | function f31() { return 31; }",
      "[... s3: 29 lines omitted (lines 32-60)]",
    ]);
  });

  it("records recoverable line_range segments", async () => {
    const { output, context } = await run(codeExtractor, code, "code", {
      selection: { lines: { ranges: [{ start: 1, end: 58 }] } },
    });
    expect(output.omittedSegments).toEqual([
      {
        id: "s1",
        type: "line_range",
        location: "lines:59-60",
        reason: "not_selected",
        recoverable: true,
      },
    ]);
    expect(recover(context, "lines:59-60")).toEqual([
      "function f59() { return 59; }\nfunction f60() { return 60; }",
    ]);
  });

  it("clamps ranges past the end and skips when nothing remains", async () => {
    const clamped = await run(codeExtractor, code, "code", {
      selection: { lines: { ranges: [{ start: 59, end: 500 }] } },
    });
    expect(clamped.output.content.split("\n").at(-1)).toBe("60 | function f60() { return 60; }");
    const beyond = await run(codeExtractor, code, "code", {
      selection: { lines: { ranges: [{ start: 100, end: 120 }] } },
    });
    expect(beyond.estimate.reason).toContain("beyond the end");
  });

  it("supports code only", () => {
    const text = makeContext(code, "text");
    expect(codeExtractor.supports(text, makeAnalysis(text))).toBe(false);
  });
});

describe("code-extractor — unified diff", () => {
  it("summarizes files and collapses long unchanged context", async () => {
    const { output, issues } = await run(codeExtractor, diff, "code");
    expect(issues).toEqual([]);
    const lines = output.content.split("\n");
    expect(lines[0]).toBe(
      "[diff summary: 2 files changed, +2 -1: src/users.ts (+1 -1), README.md (+1 -0)]",
    );
    expect(lines).toContain("[... s1: 5 unchanged lines omitted (lines 6-10)]");
    expect(lines).toContain("[... s2: 7 unchanged lines omitted (lines 19-25)]");
    expect(lines).toContain("-export function find(id) {");
    expect(lines).toContain("+export function find(id: string) {");
    expect(lines).toContain(" const line6 = 6;");
    expect(lines).toContain(" const tail3 = 3;");
    expect(lines).not.toContain(" const line5 = 5;");
    expect(lines).not.toContain(" const tail4 = 4;");
    expect(lines.slice(-4)).toEqual(["@@ -1,2 +1,3 @@", " # Title", "+New line", " end"]);
  });

  it("records unchanged context as recoverable segments", async () => {
    const { output, context } = await run(codeExtractor, diff, "code");
    expect(output.omittedSegments.map((s) => [s.location, s.note])).toEqual([
      ["lines:6-10", "unchanged diff context"],
      ["lines:19-25", "unchanged diff context"],
    ]);
    expect(recover(context, "lines:6-10")[0]?.split("\n")).toHaveLength(5);
  });

  it("treats '--- ' lines inside a hunk as removals, not headers", async () => {
    const tricky = [
      "--- a/notes.sql",
      "+++ b/notes.sql",
      "@@ -1,13 +1,12 @@",
      ...["a", "b", "c", "d", "e", "f"].map((x) => ` ${x}`),
      "--- old comment",
      ...["g", "h", "i", "j", "k", "l"].map((x) => ` ${x}`),
    ].join("\n");
    const { output, issues } = await run(codeExtractor, tricky, "code");
    expect(issues).toEqual([]);
    expect(output.content.split("\n")[0]).toBe(
      "[diff summary: 1 file changed, +0 -1: notes.sql (+0 -1)]",
    );
    expect(output.content).toContain("--- old comment");
  });

  it("skips diffs with nothing to collapse", async () => {
    const small = "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n";
    const { estimate } = await run(codeExtractor, small, "code");
    expect(estimate.reason).toContain("no long unchanged context");
  });
});

describe("code-extractor — validation", () => {
  const context = makeContext("one\ntwo\nthree\n", "code");
  const check = (content: string) =>
    codeExtractor
      .validate?.(context, { content, omittedSegments: [], warnings: [] })
      .map((i) => i.code);

  it("accepts faithful output", () => {
    expect(check("1 | one\n[... s1: 1 line omitted (lines 2-2)]\n3 | three")).toEqual([]);
    expect(check("[diff summary: x]\none\nthree")).toEqual([]);
  });

  it("rejects wrong numbering and invented lines", () => {
    expect(check("2 | one")).toEqual(["CODE_LINE_MISMATCH"]);
    expect(check("one\ninvented")).toEqual(["CODE_LINE_UNKNOWN"]);
    expect(check("three\none")).toEqual(["CODE_LINE_UNKNOWN"]);
  });
});
