import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sectionExtractor } from "../src/index.js";
import { makeAnalysis, makeContext, recover, run } from "./helpers/context.js";

const guide = readFileSync(new URL("./fixtures/guide.md", import.meta.url), "utf8");

describe("section-extractor", () => {
  it("requires an explicit selection (R5)", async () => {
    const { estimate, output } = await run(sectionExtractor, guide, "markdown");
    expect(estimate.applicable).toBe(false);
    expect(estimate.reason).toContain("selection.markdown.sections");
    expect(output.content).toBe(guide);
  });

  it("keeps the selected section with subsections and outlines the rest", async () => {
    const { output, issues } = await run(sectionExtractor, guide, "markdown", {
      selection: { markdown: { sections: ["installation"] } },
    });
    expect(issues).toEqual([]);
    expect(output.content.split("\n")).toEqual([
      "[... s1: preamble omitted (lines 1-3)]",
      '[... s2: section "# AgentContext Guide" omitted (lines 4-7)]',
      "## Installation",
      "",
      "Run the installer.",
      "",
      "```sh",
      "# not a heading",
      "pnpm install",
      "```",
      "",
      "### Windows notes",
      "",
      "Use PowerShell.",
      "",
      '[... s3: section "## Configuration" omitted (lines 21-24)]',
      '[... s4: section "## Troubleshooting" omitted (lines 25-27)]',
    ]);
  });

  it("records recoverable section segments with exact line ranges", async () => {
    const { output, context } = await run(sectionExtractor, guide, "markdown", {
      selection: { markdown: { sections: ["Configuration"] } },
    });
    const config = output.omittedSegments.find((s) => s.note === "## Troubleshooting");
    expect(config).toMatchObject({
      type: "section",
      reason: "not_selected",
      recoverable: true,
      location: "lines:25-27",
    });
    expect(recover(context, "lines:25-27")).toEqual(["## Troubleshooting\n\nCheck the logs."]);
  });

  it("matches by heading id and reports unmatched names", async () => {
    const { output } = await run(sectionExtractor, guide, "markdown", {
      selection: { markdown: { sections: ["windows-notes", "Nonexistent"] } },
    });
    expect(output.content).toContain("### Windows notes");
    expect(output.content).not.toContain("Run the installer.");
    expect(output.details).toEqual({
      matchedSections: ["windows-notes"],
      unmatchedSections: ["Nonexistent"],
    });
  });

  it("skips when no requested section matches", async () => {
    const { estimate } = await run(sectionExtractor, guide, "markdown", {
      selection: { markdown: { sections: ["Missing"] } },
    });
    expect(estimate.reason).toContain("no requested section matched");
  });

  it("selecting the top-level section omits only the preamble", async () => {
    const { output } = await run(sectionExtractor, guide, "markdown", {
      selection: { markdown: { sections: ["AgentContext Guide"] } },
    });
    expect(output.omittedSegments.map((s) => s.note)).toEqual(["preamble"]);
  });

  it("skips documents without headings and non-markdown content", async () => {
    const { estimate } = await run(sectionExtractor, "plain\ntext\n", "markdown", {
      selection: { markdown: { sections: ["x"] } },
    });
    expect(estimate.reason).toContain("no headings");
    const text = makeContext(guide, "text");
    expect(sectionExtractor.supports(text, makeAnalysis(text))).toBe(false);
  });

  it("reports overlapping segments in validate()", () => {
    const context = makeContext(guide, "markdown");
    const segment = (id: string, location: string) => ({
      id,
      type: "section" as const,
      location,
      reason: "not_selected" as const,
      recoverable: true,
    });
    const issues = sectionExtractor.validate?.(context, {
      content: "",
      omittedSegments: [segment("s1", "lines:1-5"), segment("s2", "lines:5-9")],
      warnings: [],
    });
    expect(issues).toEqual([{ code: "SECTION_OVERLAP", message: "Segments s1 and s2 overlap" }]);
  });
});
