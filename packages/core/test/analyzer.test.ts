import { readFileSync } from "node:fs";
import { sha256Hex } from "@agentcontext/shared";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import { analyze, normalize } from "../src/index.js";

const tokenizer = new FallbackEstimator();
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const run = (content: string) => analyze(normalize({ content, source: "test" }), tokenizer);

describe("analyze — common fields", () => {
  it("reports size, lines and labelled tokens", async () => {
    const analysis = await analyze(
      normalize({ content: "héllo\nworld\n", source: "s" }),
      tokenizer,
    );
    expect(analysis.sizeBytes).toBe(13);
    expect(analysis.lineCount).toBe(2);
    expect(analysis.tokens).toEqual({
      count: tokenizer.countTokens("héllo\nworld\n"),
      tokenizer: { id: "fallback-estimator", version: "1.0.0", isExact: false },
    });
  });

  it("keeps the caller's content type with high confidence", async () => {
    const analysis = await analyze(
      normalize({ content: '{"a":1}', contentType: "text", source: "s" }),
      tokenizer,
    );
    expect(analysis.contentType).toBe("text");
    expect(analysis.contentTypeSource).toBe("caller");
    expect(analysis.detectionConfidence).toBe("high");
  });

  it("reports detection confidence for detected types", async () => {
    const analysis = await run('{"a":1}');
    expect(analysis.contentType).toBe("json");
    expect(analysis.contentTypeSource).toBe("detected");
    expect(analysis.detectionConfidence).toBe("high");
  });

  it("is deterministic", async () => {
    const content = fixture("crlf.log");
    expect(await run(content)).toEqual(await run(content));
  });
});

describe("analyze — duplicates", () => {
  it("groups exact duplicate lines with counts and first line", async () => {
    const content = "a\nb\na\nc\na  \nb\n\n\n";
    const analysis = await analyze(
      normalize({ content, contentType: "logs", source: "s" }),
      tokenizer,
    );
    expect(analysis.duplicateBlocks).toEqual([
      { hash: sha256Hex("a"), occurrences: 3, firstLine: 1 },
      { hash: sha256Hex("b"), occurrences: 2, firstLine: 2 },
    ]);
  });

  it("treats CRLF and LF lines as equal and ignores blank lines", async () => {
    const analysis = await analyze(
      normalize({ content: "x\r\n\r\nx\n\n", contentType: "code", source: "s" }),
      tokenizer,
    );
    expect(analysis.duplicateBlocks).toEqual([
      { hash: sha256Hex("x"), occurrences: 2, firstLine: 1 },
    ]);
  });

  it("uses paragraphs for text and markdown", async () => {
    const content = "Para one\nline two\n\nOther\n\nPara one\nline two\n";
    const analysis = await analyze(
      normalize({ content, contentType: "text", source: "s" }),
      tokenizer,
    );
    expect(analysis.duplicateBlocks).toEqual([
      { hash: sha256Hex("Para one\nline two"), occurrences: 2, firstLine: 1 },
    ]);
  });

  it("returns no groups when nothing repeats", async () => {
    expect((await run("one\ntwo\nthree")).duplicateBlocks).toEqual([]);
  });
});

describe("analyze — logs", () => {
  it("counts levels and finds error lines including stack traces", async () => {
    const analysis = await analyze(
      normalize({ content: fixture("crlf.log"), contentType: "logs", source: "s" }),
      tokenizer,
    );
    expect(analysis.logLevels).toEqual({ info: 1, warn: 1, error: 1 });
    expect(analysis.errorLines).toEqual([3]);
  });

  it("detects exception and test-failure lines without level tokens", async () => {
    const content = [
      "running tests",
      "TypeError: x is not a function",
      "    at foo (a.js:1:1)",
      "FAIL src/a.test.ts",
      "Traceback (most recent call last):",
      "done",
    ].join("\n");
    const analysis = await analyze(
      normalize({ content, contentType: "logs", source: "s" }),
      tokenizer,
    );
    expect(analysis.errorLines).toEqual([2, 4, 5]);
  });

  it("omits log fields for other types", async () => {
    const analysis = await analyze(
      normalize({ content: "ERROR x", contentType: "text", source: "s" }),
      tokenizer,
    );
    expect(analysis).not.toHaveProperty("logLevels");
    expect(analysis).not.toHaveProperty("errorLines");
  });
});

describe("analyze — markdown", () => {
  it("extracts headings outside code fences with unique ids", async () => {
    const content = [
      "# Title",
      "",
      "Intro",
      "",
      "## Install",
      "```sh",
      "# not a heading",
      "```",
      "## Install",
      "",
      "Setext Heading",
      "==============",
      "",
      "### Last ###",
    ].join("\n");
    const analysis = await analyze(
      normalize({ content, contentType: "markdown", source: "s" }),
      tokenizer,
    );
    expect(analysis.headings).toEqual([
      { level: 1, text: "Title", line: 1, id: "title" },
      { level: 2, text: "Install", line: 5, id: "install" },
      { level: 2, text: "Install", line: 9, id: "install-1" },
      { level: 1, text: "Setext Heading", line: 11, id: "setext-heading" },
      { level: 3, text: "Last", line: 14, id: "last" },
    ]);
  });
});

describe("analyze — json", () => {
  it("reports depth, array count and largest array", async () => {
    const analysis = await run('{"a":[1,2,3,{"b":[[]]}],"c":{"d":null}}');
    expect(analysis.json).toEqual({ maxDepth: 5, arrayCount: 3, largestArrayLength: 4 });
  });

  it("handles deeply nested JSON without stack overflow", async () => {
    const depth = 20_000;
    let nested: unknown = [];
    for (let i = 1; i < depth; i++) nested = [nested];
    const context = normalize({ content: "[]", contentType: "json", source: "s" });
    context.json = nested;
    const analysis = await analyze(context, tokenizer);
    expect(analysis.json?.maxDepth).toBe(depth);
  });

  it("omits json stats when JSON is invalid", async () => {
    const analysis = await analyze(
      normalize({ content: "{", contentType: "json", source: "s" }),
      tokenizer,
    );
    expect(analysis).not.toHaveProperty("json");
  });
});
