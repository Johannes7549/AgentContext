import { readFileSync } from "node:fs";
import { AgentContextError, canonicalJson, lineText, sha256Hex } from "@agentcontext/shared";
import { describe, expect, it } from "vitest";
import { type ContentTypeDetector, normalize } from "../src/index.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const jsonDetector: ContentTypeDetector = (text) =>
  text.trimStart().startsWith("{")
    ? { contentType: "json", confidence: "high" }
    : { contentType: "text", confidence: "low" };

describe("normalize — text", () => {
  it.each([
    ["sample.json", "json"],
    ["crlf.log", "logs"],
    ["bom-unicode.md", "markdown"],
    ["code.ts", "code"],
  ] as const)("keeps %s byte-for-byte", (name, contentType) => {
    const content = fixture(name);
    const ctx = normalize({ content, contentType, source: `file:${name}` });
    expect(ctx.original).toBe(content);
    expect(ctx.originalHash).toBe(sha256Hex(content));
    expect(ctx.contentType).toBe(contentType);
    expect(ctx.contentTypeSource).toBe("caller");
    const rebuilt = ctx.lines.lineStarts
      .map((start, i) => content.slice(start, ctx.lines.lineStarts[i + 1] ?? content.length))
      .join("");
    expect(rebuilt).toBe(content);
  });

  it("indexes CRLF lines without altering them", () => {
    const content = fixture("crlf.log");
    const ctx = normalize({ content, contentType: "logs", source: "s" });
    expect(ctx.lineEnding).toBe("crlf");
    expect(ctx.lines.count).toBe(4);
    expect(lineText(ctx.original, ctx.lines, 3)).toBe(
      "2026-11-22T10:00:02Z ERROR connection refused",
    );
    expect(ctx.original).toContain("\r\n");
  });

  it("preserves a UTF-8 BOM and non-ASCII characters", () => {
    const content = fixture("bom-unicode.md");
    const ctx = normalize({ content, contentType: "markdown", source: "s" });
    expect(ctx.original.charCodeAt(0)).toBe(0xfeff);
    expect(ctx.original).toContain("café ✓ 😀");
  });

  it("parses JSON when the type is json (including with a BOM)", () => {
    const ctx = normalize({ content: fixture("sample.json"), contentType: "json", source: "s" });
    expect(ctx.json).toEqual({
      items: [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
      ],
      total: 2,
    });
    const bom = normalize({ content: '﻿{"a":1}', contentType: "json", source: "s" });
    expect(bom.json).toEqual({ a: 1 });
    expect(bom.original).toBe('﻿{"a":1}');
  });

  it("leaves json undefined when JSON is invalid instead of throwing", () => {
    const ctx = normalize({ content: '{"a":', contentType: "json", source: "s" });
    expect(ctx.contentType).toBe("json");
    expect(ctx).not.toHaveProperty("json");
  });

  it("does not parse JSON for other content types", () => {
    expect(normalize({ content: "{}", contentType: "text", source: "s" })).not.toHaveProperty(
      "json",
    );
  });

  it("uses the detector only when the caller gave no type", () => {
    const detected = normalize(
      { content: '{"a":1}', source: "s" },
      { detectContentType: jsonDetector },
    );
    expect(detected.contentType).toBe("json");
    expect(detected.contentTypeSource).toBe("detected");
    expect(detected.json).toEqual({ a: 1 });

    const caller = normalize(
      { content: '{"a":1}', contentType: "text", source: "s" },
      { detectContentType: jsonDetector },
    );
    expect(caller.contentType).toBe("text");
    expect(caller.contentTypeSource).toBe("caller");
  });

  it("falls back to unknown without a detector", () => {
    const ctx = normalize({ content: "hello", source: "s" });
    expect(ctx.contentType).toBe("unknown");
    expect(ctx.contentTypeSource).toBe("detected");
  });

  it("handles empty content", () => {
    const ctx = normalize({ content: "", source: "s" });
    expect(ctx.lines).toEqual({ count: 0, lineStarts: [] });
    expect(ctx.lineEnding).toBe("none");
  });

  it("copies taskContext and metadata only when present", () => {
    const withExtras = normalize({
      content: "x",
      source: "s",
      taskContext: "find the failing test",
      metadata: { tool: "pnpm" },
    });
    expect(withExtras.taskContext).toBe("find the failing test");
    expect(withExtras.metadata).toEqual({ tool: "pnpm" });
    const without = normalize({ content: "x", source: "s" });
    expect(without).not.toHaveProperty("taskContext");
    expect(without).not.toHaveProperty("metadata");
  });
});

describe("normalize — MCP content blocks", () => {
  const blocks = [
    { type: "text", text: "line one\nline two\n", annotations: { priority: 1 } },
    { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    { type: "text", text: '{"ok":true}' },
    { type: "resource_link", uri: "file:///tmp/a.txt", name: "a.txt" },
  ];

  it("preserves block types, order and extra fields", () => {
    const ctx = normalize(
      { content: blocks, source: "tool:x" },
      { detectContentType: jsonDetector },
    );
    expect(ctx.contentType).toBe("mcp_content");
    expect(ctx.contentTypeSource).toBe("detected");
    expect(ctx.blocks?.map((b) => [b.index, b.block.type])).toEqual([
      [0, "text"],
      [1, "image"],
      [2, "text"],
      [3, "resource_link"],
    ]);
    expect(ctx.blocks?.map((b) => b.block)).toEqual(blocks);
  });

  it("normalizes only text blocks, each with its own context", () => {
    const ctx = normalize(
      { content: blocks, source: "tool:x" },
      { detectContentType: jsonDetector },
    );
    const [first, image, third] = ctx.blocks ?? [];
    expect(first?.text?.original).toBe("line one\nline two\n");
    expect(first?.text?.source).toBe("tool:x#block[0]");
    expect(first?.text?.lines.count).toBe(2);
    expect(image).not.toHaveProperty("text");
    expect(third?.text?.contentType).toBe("json");
    expect(third?.text?.json).toEqual({ ok: true });
  });

  it("uses canonical JSON of the blocks as the original", () => {
    const ctx = normalize({ content: blocks, source: "tool:x" });
    expect(ctx.original).toBe(canonicalJson(blocks));
    expect(JSON.parse(ctx.original)).toEqual(blocks);
    expect(ctx.originalHash).toBe(sha256Hex(ctx.original));
  });

  it("records caller as the type source when mcp_content is given explicitly", () => {
    const ctx = normalize({ content: blocks, contentType: "mcp_content", source: "s" });
    expect(ctx.contentTypeSource).toBe("caller");
  });
});

describe("normalize — determinism and validation", () => {
  it("produces identical output for identical input", () => {
    const input = { content: fixture("crlf.log"), source: "s", metadata: { b: 2, a: 1 } };
    expect(normalize(input, { detectContentType: jsonDetector })).toEqual(
      normalize(structuredClone(input), { detectContentType: jsonDetector }),
    );
  });

  it("does not mutate its input", () => {
    const input = { content: [{ type: "text", text: "x" }], source: "s" };
    const copy = structuredClone(input);
    normalize(input);
    expect(input).toEqual(copy);
  });

  it("rejects invalid input with INVALID_INPUT", () => {
    expect(() => normalize({ content: 1, source: "s" })).toThrow(AgentContextError);
    try {
      normalize({ content: "x" });
    } catch (error) {
      expect((error as AgentContextError).code).toBe("INVALID_INPUT");
    }
  });

  it("enforces maxInputBytes on UTF-8 size", () => {
    expect(() => normalize({ content: "😀😀", source: "s" }, { maxInputBytes: 7 })).toThrow(
      expect.objectContaining({ code: "INPUT_TOO_LARGE" }),
    );
    expect(() => normalize({ content: "😀😀", source: "s" }, { maxInputBytes: 8 })).not.toThrow();
  });

  it("enforces maxInputBytes on block input", () => {
    const content = [{ type: "text", text: "x".repeat(100) }];
    expect(() => normalize({ content, source: "s" }, { maxInputBytes: 50 })).toThrow(
      expect.objectContaining({ code: "INPUT_TOO_LARGE" }),
    );
  });
});
