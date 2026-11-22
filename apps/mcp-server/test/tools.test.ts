import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRegistrars } from "../src/index.js";
import { rawConnection, tempDir, testConfig, testRuntime } from "./helpers.js";

const log = readFileSync(
  new URL("../../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function connect(sessionId = "sess-a", dir?: string) {
  const temp = dir ? { dir, remove: () => {} } : tempDir();
  const runtime = testRuntime(testConfig(temp.dir), sessionId);
  const connection = rawConnection(runtime, defaultRegistrars);
  cleanups.push(
    temp.remove,
    () => runtime.close(),
    () => connection.close(),
  );
  await connection.initialize();
  const call = async (name: string, args: Record<string, unknown>) =>
    (
      (await connection.request("tools/call", { name, arguments: args })) as {
        result: {
          content: { type: string; text: string }[];
          structuredContent?: Record<string, unknown>;
          isError?: boolean;
        };
      }
    ).result;
  return { connection, call, dir: temp.dir };
}

describe("tools/list", () => {
  it("lists every tool with schemas and annotations", async () => {
    const { connection } = await connect();
    const response = (await connection.request("tools/list")) as {
      result: {
        tools: {
          name: string;
          description: string;
          inputSchema: { properties: object };
          outputSchema?: object;
          annotations?: object;
        }[];
      };
    };
    const tools = response.result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      "optimize_context",
      "retrieve_context",
      "read_file",
      "get_optimization_stats",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThan(400);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
    expect(Object.keys(tools[0]?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["content", "contentType", "source", "options"]),
    );
  });
});

describe("optimize_context", () => {
  it("returns compact content with a recovery footer and metadata-only structured content", async () => {
    const { call } = await connect();
    const result = await call("optimize_context", { content: log, source: "command:pnpm test" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("[... s1: repeated");
    expect(text).toContain("[agentcontext] log-compressor:");
    expect(text).toContain("retrieve_context");
    expect(result.structuredContent).toMatchObject({
      recoveryAvailable: true,
      strategy: "log-compressor",
      metrics: { tokenCountIsExact: false },
    });
    expect(result.structuredContent).not.toHaveProperty("content");
    expect(JSON.stringify(result.structuredContent)).not.toContain("connection refused");
  });

  it("passes small content through without a footer", async () => {
    const { call } = await connect();
    const result = await call("optimize_context", { content: "short output" });
    expect(result.content[0]?.text).toBe("short output");
    expect(result.structuredContent).toMatchObject({ strategy: "passthrough", contextId: null });
  });

  it("reports budget warnings in the footer", async () => {
    const { call } = await connect();
    const result = await call("optimize_context", { content: log, options: { maxTokens: 5 } });
    expect(result.content[0]?.text).toContain("[agentcontext] BUDGET_EXCEEDED:");
  });

  it("returns isError results for invalid arguments and oversized input", async () => {
    const { call } = await connect();
    const invalid = await call("optimize_context", { content: log, options: { maxTokens: -5 } });
    expect(invalid.isError).toBe(true);
    const wrongType = await call("optimize_context", { content: 42 });
    expect(wrongType.isError).toBe(true);
  });
});

describe("retrieve_context", () => {
  it("recovers a segment and the full original", async () => {
    const { call } = await connect();
    const optimized = await call("optimize_context", { content: log });
    const contextId = optimized.structuredContent?.contextId as string;

    const segment = await call("retrieve_context", {
      contextId,
      selector: { type: "segment_id", value: "s1" },
    });
    expect(segment.isError).toBeUndefined();
    expect(segment.content[0]?.text).toContain("GET /health 200 2ms");
    expect(segment.structuredContent).toMatchObject({ status: "OK", contextId, truncated: false });

    const full = await call("retrieve_context", { contextId });
    expect(full.content[0]?.text).toBe(log);

    const keyword = await call("retrieve_context", {
      contextId,
      selector: { type: "keyword", value: "typeerror" },
    });
    expect(keyword.content[0]?.text).toContain("TypeError: Cannot read properties");
    expect(keyword.structuredContent?.matchLocations).toEqual([
      expect.stringMatching(/^lines:72-72;offset:/),
    ]);
  });

  it("hides contexts from other sessions as NOT_FOUND", async () => {
    const first = await connect("sess-a");
    const optimized = await first.call("optimize_context", { content: log });
    const contextId = optimized.structuredContent?.contextId as string;

    const second = await connect("sess-b", first.dir);
    const result = await second.call("retrieve_context", { contextId });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "NOT_FOUND: Context not found or not accessible from this session",
    );
  });

  it("reports unknown ids, bad selectors and size limits as errors", async () => {
    const { call } = await connect();
    const optimized = await call("optimize_context", { content: log });
    const contextId = optimized.structuredContent?.contextId as string;
    expect(
      (await call("retrieve_context", { contextId: "ctx_01JD0000000000000000000000" })).content[0]
        ?.text,
    ).toMatch(/^NOT_FOUND:/);
    expect(
      (
        await call("retrieve_context", {
          contextId,
          selector: { type: "segment_id", value: "s99" },
        })
      ).content[0]?.text,
    ).toMatch(/^INVALID_SELECTOR:/);
    expect((await call("retrieve_context", { contextId, maxTokens: 3 })).content[0]?.text).toMatch(
      /^TOO_LARGE:/,
    );
    expect((await call("retrieve_context", { contextId: "not-an-id" })).isError).toBe(true);
  });
});
