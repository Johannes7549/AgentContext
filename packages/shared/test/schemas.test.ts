import { describe, expect, it } from "vitest";
import {
  AgentContextError,
  CompressionOptionsSchema,
  CompressionResultSchema,
  ContentBlockSchema,
  ContextInputSchema,
  OmittedSegmentSchema,
  parseOrThrow,
  RetrievalRequestSchema,
  RetrievalScopeSchema,
} from "../src/index.js";

const CTX = "ctx_01JD0000000000000000000000";
const tokenizer = { id: "fallback-estimator", version: "1.0.0", isExact: false };

describe("ContextInputSchema", () => {
  it("accepts text input without contentType", () => {
    expect(ContextInputSchema.safeParse({ content: "hello", source: "test" }).success).toBe(true);
  });

  it("accepts content blocks and preserves unknown block fields", () => {
    const parsed = ContextInputSchema.parse({
      content: [
        { type: "text", text: "a", annotations: { audience: ["user"] } },
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "resource_link", uri: "file:///x", name: "x" },
      ],
      source: "tool:x",
    });
    expect(parsed.content).toEqual([
      { type: "text", text: "a", annotations: { audience: ["user"] } },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "resource_link", uri: "file:///x", name: "x" },
    ]);
  });

  it.each([
    ["missing source", { content: "x" }],
    ["empty source", { content: "x", source: "" }],
    ["unknown property", { content: "x", source: "s", extra: 1 }],
    ["unknown content type", { content: "x", source: "s", contentType: "yaml" }],
    ["empty block list", { content: [], source: "s" }],
    [
      "blocks with non-mcp type",
      { content: [{ type: "text", text: "a" }], source: "s", contentType: "text" },
    ],
    ["text with mcp type", { content: "x", source: "s", contentType: "mcp_content" }],
    ["malformed block", { content: [{ type: "image", data: "x" }], source: "s" }],
    ["explicit undefined optional", { content: "x", source: "s", taskContext: undefined }],
  ])("rejects %s", (_name, value) => {
    expect(ContextInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("CompressionOptionsSchema", () => {
  it("accepts a full option set", () => {
    const result = CompressionOptionsSchema.safeParse({
      maxTokens: 2000,
      targetReduction: 0.5,
      preserveStructure: true,
      preserveErrors: true,
      allowLossy: false,
      strategy: "json-pruner",
      minBenefitTokens: 100,
      selection: {
        json: { include: ["$.items[*].id"], exclude: ["$.debug"], maxArrayItems: 10, maxDepth: 5 },
        markdown: { sections: ["Install"] },
        lines: { ranges: [{ start: 1, end: 20 }], context: 2 },
        logs: { levels: ["error", "warn"], maxGroupExamples: 1 },
      },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["zero maxTokens", { maxTokens: 0 }],
    ["fractional maxTokens", { maxTokens: 1.5 }],
    ["targetReduction > 1", { targetReduction: 1.2 }],
    ["inverted line range", { selection: { lines: { ranges: [{ start: 5, end: 2 }] } } }],
    ["line 0", { selection: { lines: { ranges: [{ start: 0, end: 2 }] } } }],
    ["empty ranges", { selection: { lines: { ranges: [] } } }],
    ["unknown log level", { selection: { logs: { levels: ["verbose"] } } }],
    ["unknown selection key", { selection: { yaml: {} } }],
  ])("rejects %s", (_name, value) => {
    expect(CompressionOptionsSchema.safeParse(value).success).toBe(false);
  });
});

describe("ContentBlockSchema", () => {
  it("rejects an unknown block type", () => {
    expect(ContentBlockSchema.safeParse({ type: "video", data: "x" }).success).toBe(false);
  });
});

describe("OmittedSegmentSchema", () => {
  const base = {
    id: "s1",
    type: "log_group",
    location: "lines:3-9",
    reason: "repeated_log_line",
    recoverable: true,
  };

  it("accepts a valid segment", () => {
    expect(
      OmittedSegmentSchema.safeParse({ ...base, occurrences: 7, note: "7 repeats" }).success,
    ).toBe(true);
  });

  it.each([
    ["bad id", { ...base, id: "seg1" }],
    ["id s0", { ...base, id: "s0" }],
    ["unknown reason", { ...base, reason: "irrelevant" }],
    ["zero occurrences", { ...base, occurrences: 0 }],
  ])("rejects %s", (_name, value) => {
    expect(OmittedSegmentSchema.safeParse(value).success).toBe(false);
  });
});

describe("CompressionResultSchema", () => {
  const result = {
    contextId: CTX,
    content: "compact",
    metrics: {
      originalTokens: 100,
      optimizedTokens: 40,
      savedTokens: 60,
      reductionPercentage: 60,
      tokenCountIsExact: false,
      tokenizer,
      processingTimeMs: 3.2,
    },
    strategy: "log-compressor",
    recoveryAvailable: true,
    omittedSegments: [],
    warnings: [{ code: "NO_BENEFIT", message: "x" }],
  };

  it("accepts a valid result", () => {
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects recoverable results without a context id", () => {
    expect(CompressionResultSchema.safeParse({ ...result, contextId: null }).success).toBe(false);
  });

  it("rejects exactness that disagrees with the tokenizer", () => {
    const metrics = { ...result.metrics, tokenCountIsExact: true };
    expect(CompressionResultSchema.safeParse({ ...result, metrics }).success).toBe(false);
  });

  it("rejects malformed context ids", () => {
    expect(CompressionResultSchema.safeParse({ ...result, contextId: "ctx_123" }).success).toBe(
      false,
    );
  });
});

describe("RetrievalRequestSchema", () => {
  it.each([
    [{ contextId: CTX }],
    [{ contextId: CTX, selector: { type: "line_range", value: "10-42" }, contextLines: 3 }],
    [{ contextId: CTX, selector: { type: "json_path", value: "$.a[0]" }, maxTokens: 500 }],
    [{ contextId: CTX, selector: { type: "keyword", value: "Error" } }],
    [{ contextId: CTX, selector: { type: "segment_id", value: "s12" } }],
  ])("accepts %j", (value) => {
    expect(RetrievalRequestSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["bad line range", { contextId: CTX, selector: { type: "line_range", value: "0-4" } }],
    ["unknown selector", { contextId: CTX, selector: { type: "regex", value: "x" } }],
    ["too much context", { contextId: CTX, contextLines: 51 }],
    ["scope in request", { contextId: CTX, workspaceId: "w" }],
  ])("rejects %s", (_name, value) => {
    expect(RetrievalRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe("RetrievalScopeSchema", () => {
  it("requires a known mode", () => {
    expect(
      RetrievalScopeSchema.safeParse({ workspaceId: "w", sessionId: "s", mode: "session" }).success,
    ).toBe(true);
    expect(
      RetrievalScopeSchema.safeParse({ workspaceId: "w", sessionId: "s", mode: "global" }).success,
    ).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data", () => {
    expect(parseOrThrow(ContextInputSchema, { content: "x", source: "s" }, "input")).toEqual({
      content: "x",
      source: "s",
    });
  });

  it("throws INVALID_INPUT without echoing rejected values", () => {
    const secret = "sk-very-secret-value";
    let caught: unknown;
    try {
      parseOrThrow(ContextInputSchema, { content: 42, source: secret, extra: secret }, "input");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentContextError);
    const error = caught as AgentContextError;
    expect(error.code).toBe("INVALID_INPUT");
    expect(JSON.stringify(error.toJSON())).not.toContain(secret);
    expect(error.details?.issueCount).toBeGreaterThan(0);
  });
});
