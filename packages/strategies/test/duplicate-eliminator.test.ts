import { describe, expect, it } from "vitest";
import { duplicateEliminator, MIN_DUPLICATE_CHARS } from "../src/index.js";
import { makeAnalysis, makeContext, recover, run } from "./helpers/context.js";

const longLine = "Warning: deprecated configuration key 'legacyMode' will be removed";
const para =
  "This paragraph is repeated in the document because it was\ncopied from a shared template by mistake.";

describe("duplicate-eliminator — lines", () => {
  const content = ["start", longLine, "middle", longLine, longLine, longLine, "end", longLine].join(
    "\n",
  );

  it("keeps the first occurrence and merges consecutive duplicates into one marker", async () => {
    const { output, issues } = await run(duplicateEliminator, content, "logs");
    expect(issues).toEqual([]);
    expect(output.content.split("\n")).toEqual([
      "start",
      longLine,
      "middle",
      "[... s1: 3 duplicates of line 2]",
      "end",
      "[... s1: duplicate of line 2]",
    ]);
  });

  it("records one segment per group with every omitted location", async () => {
    const { output, context } = await run(duplicateEliminator, content, "logs");
    expect(output.omittedSegments).toEqual([
      {
        id: "s1",
        type: "duplicate_block",
        location: "lines:4-4;lines:5-5;lines:6-6;lines:8-8",
        reason: "duplicate",
        recoverable: true,
        occurrences: 5,
        note: "4 duplicates of line 2",
      },
    ]);
    expect(recover(context, output.omittedSegments[0]?.location ?? "")).toEqual([
      longLine,
      longLine,
      longLine,
      longLine,
    ]);
  });

  it("ignores short units and trailing whitespace differences", async () => {
    const short = await run(duplicateEliminator, "ok\nok\nok\nok\n", "logs");
    expect(short.estimate.applicable).toBe(false);
    expect("ok".length).toBeLessThan(MIN_DUPLICATE_CHARS);
    const spaced = await run(duplicateEliminator, `${longLine}\n${longLine}   \n`, "logs");
    expect(spaced.output.omittedSegments[0]?.occurrences).toBe(2);
  });
});

describe("duplicate-eliminator — paragraphs", () => {
  it("collapses repeated paragraphs in text and markdown", async () => {
    const content = `# Guide\n\n${para}\n\nUnique middle paragraph.\n\n${para}\n`;
    const { output, issues, context } = await run(duplicateEliminator, content, "markdown");
    expect(issues).toEqual([]);
    expect(output.content).toBe(
      `# Guide\n\n${para}\n\nUnique middle paragraph.\n\n[... s1: duplicate of lines 3-4]`,
    );
    expect(output.omittedSegments[0]).toMatchObject({ location: "lines:8-9", occurrences: 2 });
    expect(recover(context, "lines:8-9")).toEqual([para]);
  });

  it("does not treat a paragraph and a line of the same text as different units in text mode", async () => {
    const { estimate } = await run(duplicateEliminator, `${para}\n\nother\n`, "text");
    expect(estimate.applicable).toBe(false);
  });
});

describe("duplicate-eliminator — support and validation", () => {
  it("does not support code or json", () => {
    for (const type of ["code", "json"] as const) {
      const context = makeContext(`${longLine}\n${longLine}`, type);
      expect(duplicateEliminator.supports(context, makeAnalysis(context))).toBe(false);
    }
  });

  it("reports mismatched groups and wrong counts", () => {
    const context = makeContext(
      `${longLine}\nsomething else entirely, long enough to count\n${longLine}`,
      "logs",
    );
    const issues = duplicateEliminator.validate?.(context, {
      content: longLine,
      omittedSegments: [
        {
          id: "s1",
          type: "duplicate_block",
          location: "lines:2-2;lines:3-3",
          reason: "duplicate",
          recoverable: true,
          occurrences: 2,
        },
      ],
      warnings: [],
    });
    expect(issues?.map((i) => i.code)).toEqual(["DUPLICATE_MISMATCH", "DUPLICATE_COUNT_MISMATCH"]);
  });

  it("is deterministic", async () => {
    const content = `${longLine}\n${longLine}\n${para}\n`;
    expect((await run(duplicateEliminator, content, "logs")).output).toEqual(
      (await run(duplicateEliminator, content, "logs")).output,
    );
  });
});
