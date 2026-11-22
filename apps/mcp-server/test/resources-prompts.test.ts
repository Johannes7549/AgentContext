import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRegistrars, GUIDELINES } from "../src/index.js";
import { rawConnection, tempDir, testConfig, testRuntime } from "./helpers.js";

const log = readFileSync(
  new URL("../../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Json = Record<string, unknown>;

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
  const call = async (name: string, args: Json = {}) =>
    ((await connection.request("tools/call", { name, arguments: args })) as { result: Json })
      .result;
  return { connection, call, dir: temp.dir };
}

describe("get_optimization_stats", () => {
  it("reports session stats from persisted events, labelled as estimates", async () => {
    const { call } = await connect();
    const optimized = (await call("optimize_context", { content: log })) as {
      structuredContent: Json;
    };
    await call("retrieve_context", { contextId: optimized.structuredContent.contextId });
    await call("optimize_context", { content: "tiny" });

    const stats = (await call("get_optimization_stats")) as {
      content: { text: string }[];
      structuredContent: Json;
    };
    expect(stats.structuredContent).toMatchObject({
      scope: "session",
      since: null,
      optimizations: 1,
      skipped: 1,
      retrievals: 1,
      tokenizer: { id: "fallback-estimator", isExact: false },
    });
    const s = stats.structuredContent as {
      originalTokens: number;
      optimizedTokens: number;
      recoveredTokens: number;
      netSavedTokens: number;
    };
    expect(s.netSavedTokens).toBe(s.originalTokens - s.optimizedTokens - s.recoveredTokens);
    expect(stats.content[0]?.text).toContain("estimated with fallback-estimator");
  });

  it("separates sessions and supports 'all' and 'since'", async () => {
    const first = await connect("sess-a");
    await first.call("optimize_context", { content: log });
    const second = await connect("sess-b", first.dir);
    await second.call("optimize_context", { content: log });

    expect(
      ((await second.call("get_optimization_stats")) as { structuredContent: Json })
        .structuredContent,
    ).toMatchObject({
      optimizations: 1,
    });
    expect(
      (
        (await second.call("get_optimization_stats", { scope: "all" })) as {
          structuredContent: Json;
        }
      ).structuredContent,
    ).toMatchObject({ optimizations: 2 });
    expect(
      (
        (await second.call("get_optimization_stats", {
          scope: "all",
          since: "2999-01-01T00:00:00Z",
        })) as {
          structuredContent: Json;
        }
      ).structuredContent,
    ).toMatchObject({ optimizations: 0 });
    expect(
      ((await second.call("get_optimization_stats", { since: "yesterday" })) as Json).isError,
    ).toBe(true);
  });
});

describe("resources", () => {
  it("lists the stats resource and the metadata template", async () => {
    const { connection } = await connect();
    const resources = (await connection.request("resources/list")) as {
      result: { resources: Json[] };
    };
    expect(resources.result.resources.map((r) => r.uri)).toEqual(["agentcontext://stats"]);
    const templates = (await connection.request("resources/templates/list")) as {
      result: { resourceTemplates: Json[] };
    };
    expect(templates.result.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "agentcontext://context/{contextId}/metadata",
    ]);
  });

  it("reads stats as JSON", async () => {
    const { connection, call } = await connect();
    await call("optimize_context", { content: log });
    const read = (await connection.request("resources/read", { uri: "agentcontext://stats" })) as {
      result: { contents: { text: string; mimeType: string }[] };
    };
    const body = JSON.parse(read.result.contents[0]?.text ?? "{}");
    expect(body.session.optimizations).toBe(1);
    expect(body.all.optimizations).toBe(1);
  });

  it("returns context metadata without content, only within scope", async () => {
    const first = await connect("sess-a");
    const optimized = (await first.call("optimize_context", {
      content: log,
      source: "command:test",
    })) as {
      structuredContent: Json;
    };
    const uri = `agentcontext://context/${optimized.structuredContent.contextId}/metadata`;
    const read = (await first.connection.request("resources/read", { uri })) as {
      result: { contents: { text: string }[] };
    };
    const text = read.result.contents[0]?.text ?? "";
    const metadata = JSON.parse(text);
    expect(metadata).toMatchObject({ contentType: "logs", source: "command:test", expired: false });
    expect(metadata.omittedSegments.length).toBeGreaterThan(0);
    expect(text).not.toContain("connection refused");

    const second = await connect("sess-b", first.dir);
    const hidden = (await second.connection.request("resources/read", { uri })) as Json;
    expect(hidden).toHaveProperty("error");
    const bogus = (await first.connection.request("resources/read", {
      uri: "agentcontext://context/not-an-id/metadata",
    })) as Json;
    expect(bogus).toHaveProperty("error");
  });
});

describe("agentcontext_guidelines prompt", () => {
  it("is listed and returns the guidelines, including the untrusted-data rule", async () => {
    const { connection } = await connect();
    const list = (await connection.request("prompts/list")) as { result: { prompts: Json[] } };
    expect(list.result.prompts.map((p) => p.name)).toEqual(["agentcontext_guidelines"]);
    const prompt = (await connection.request("prompts/get", {
      name: "agentcontext_guidelines",
    })) as {
      result: { messages: { role: string; content: { type: string; text: string } }[] };
    };
    expect(prompt.result.messages).toEqual([
      { role: "user", content: { type: "text", text: GUIDELINES } },
    ]);
    expect(GUIDELINES).toContain("untrusted data");
  });
});
