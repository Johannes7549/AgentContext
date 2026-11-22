import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ContentType,
  canonicalJson,
  type OmittedSegment,
  type RetrievalScope,
  sha256Hex,
  type Tokenizer,
} from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import { afterEach, describe, expect, it } from "vitest";
import { retrieveContext } from "../src/index.js";

const tokenizer: Tokenizer = {
  id: "chars",
  version: "1",
  isExact: false,
  countTokens: (text) => Math.ceil(text.length / 4),
};
const scope: RetrievalScope = { workspaceId: "w", sessionId: "s1", mode: "session" };
const ID = "ctx_01JD0000000000000000000001";

const open: SqliteStorage[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup(
  content: string,
  contentType: ContentType = "text",
  segments: OmittedSegment[] = [],
  expiresAt = new Date(Date.UTC(2100, 0, 1)),
) {
  const directory = mkdtempSync(join(tmpdir(), "agentcontext-retrieve-"));
  dirs.push(directory);
  const storage = new SqliteStorage({ directory });
  open.push(storage);
  await storage.putOriginal({
    contextId: ID,
    workspaceId: "w",
    sessionId: "s1",
    content,
    contentHash: sha256Hex(content),
    contentType,
    source: "test",
    expiresAt,
  });
  await storage.putVariant({
    variantId: "var_1",
    contextId: ID,
    strategy: "test",
    strategyVersion: "1",
    optimizedContent: "x",
    originalTokens: 1,
    optimizedTokens: 1,
    tokenizer,
    omittedSegments: segments,
  });
  const get = (request: Record<string, unknown> = {}, s: RetrievalScope = scope, extra = {}) =>
    retrieveContext(storage, { contextId: ID, ...request }, s, { tokenizer, ...extra });
  return { storage, get };
}

const text = "alpha\r\nbeta ERROR one\ngamma\ndelta error two\nepsilon\n";

describe("retrieveContext — access checks", () => {
  it("returns the full original exactly", async () => {
    const { get } = await setup(text);
    expect(await get()).toEqual({
      status: "OK",
      contextId: ID,
      content: text,
      truncated: false,
      tokens: {
        count: Math.ceil(text.length / 4),
        tokenizer: { id: "chars", version: "1", isExact: false },
      },
    });
  });

  it("enforces workspace and session scope", async () => {
    const { get } = await setup(text);
    expect((await get({}, { ...scope, sessionId: "other" })).status).toBe("UNAUTHORIZED");
    expect((await get({}, { ...scope, sessionId: "other", mode: "workspace" })).status).toBe("OK");
    expect((await get({}, { ...scope, workspaceId: "x", mode: "workspace" })).status).toBe(
      "UNAUTHORIZED",
    );
  });

  it("reports expired, missing and corrupted contexts", async () => {
    const expired = await setup(text, "text", [], new Date(1));
    expect((await expired.get()).status).toBe("EXPIRED");
    expect((await expired.get({ contextId: "ctx_01JD0000000000000000000009" })).status).toBe(
      "NOT_FOUND",
    );

    const { storage, get } = await setup(text);
    storage.db.prepare("UPDATE contexts SET inline_content = 'tampered'").run();
    expect((await get()).status).toBe("INTEGRITY_ERROR");
  });

  it("throws INVALID_INPUT for malformed requests or scopes", async () => {
    const { storage } = await setup(text);
    await expect(
      retrieveContext(storage, { contextId: "bad" }, scope, { tokenizer }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      retrieveContext(storage, { contextId: ID }, { mode: "x" }, { tokenizer }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("retrieveContext — selectors", () => {
  it("returns exact line ranges with context and clamps the end", async () => {
    const { get } = await setup(text);
    expect(await get({ selector: { type: "line_range", value: "2-3" } })).toMatchObject({
      status: "OK",
      content: "beta ERROR one\ngamma\n",
      matches: [{ location: "lines:2-3", text: "beta ERROR one\ngamma\n" }],
    });
    expect(
      await get({ selector: { type: "line_range", value: "1-1" }, contextLines: 1 }),
    ).toMatchObject({ status: "OK", content: "alpha\r\nbeta ERROR one\n" });
    expect(await get({ selector: { type: "line_range", value: "5-99" } })).toMatchObject({
      content: "epsilon\n",
    });
    expect((await get({ selector: { type: "line_range", value: "9-10" } })).status).toBe(
      "INVALID_SELECTOR",
    );
    expect((await get({ selector: { type: "line_range", value: "3-2" } })).status).toBe(
      "INVALID_SELECTOR",
    );
  });

  it("finds keywords case-insensitively with line and offset locations", async () => {
    const { get } = await setup(text);
    const result = await get({ selector: { type: "keyword", value: "error" } });
    expect(result).toMatchObject({
      status: "OK",
      truncated: false,
      matches: [
        { location: "lines:2-2;offset:12-17", text: "beta ERROR one" },
        { location: "lines:4-4;offset:34-39", text: "delta error two" },
      ],
      content: "--- line 2 ---\nbeta ERROR one\n--- line 4 ---\ndelta error two",
    });
    expect(text.slice(12, 17)).toBe("ERROR");
    expect(text.slice(34, 39)).toBe("error");
  });

  it("treats keywords literally and includes context lines", async () => {
    const { get } = await setup("a.b\naxb\nc\n");
    const result = await get({ selector: { type: "keyword", value: "a.b" }, contextLines: 1 });
    expect(result).toMatchObject({
      matches: [{ location: "lines:1-2;offset:0-3", text: "a.b\naxb" }],
    });
  });

  it("truncates keyword matches by count or size and says so", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `hit ${i}`).join("\n");
    const { get } = await setup(many);
    const limited = await get({ selector: { type: "keyword", value: "hit" } }, scope, {
      maxKeywordMatches: 5,
    });
    expect(limited.status === "OK" && limited.matches?.length).toBe(5);
    expect(limited.status === "OK" && limited.truncated).toBe(true);
    const budget = await get({ selector: { type: "keyword", value: "hit" }, maxTokens: 12 });
    expect(budget.status === "OK" && budget.truncated).toBe(true);
    expect(budget.status === "OK" && budget.tokens.count).toBeLessThanOrEqual(12);
  });

  it("evaluates JSONPath on JSON content", async () => {
    const json = JSON.stringify({
      users: [
        { id: 1, email: "a@example.com" },
        { id: 2, email: "b@example.com" },
      ],
    });
    const { get } = await setup(json, "json");
    expect(await get({ selector: { type: "json_path", value: "$.users[1].email" } })).toMatchObject(
      {
        content: '"b@example.com"',
        matches: [{ location: "json:$['users'][1]['email']", text: '"b@example.com"' }],
      },
    );
    const all = await get({ selector: { type: "json_path", value: "$.users[*].id" } });
    expect(all.status === "OK" && JSON.parse(all.content)).toEqual([
      { path: "$['users'][0]['id']", value: 1 },
      { path: "$['users'][1]['id']", value: 2 },
    ]);
    expect(await get({ selector: { type: "json_path", value: "$.missing" } })).toMatchObject({
      status: "OK",
      content: "",
      matches: [],
    });
    expect((await get({ selector: { type: "json_path", value: "$..id" } })).status).toBe(
      "INVALID_SELECTOR",
    );
  });

  it("rejects json_path on non-JSON content", async () => {
    const { get } = await setup(text);
    expect((await get({ selector: { type: "json_path", value: "$.a" } })).status).toBe(
      "INVALID_SELECTOR",
    );
  });

  it("returns exactly the content of recorded segments", async () => {
    const segments: OmittedSegment[] = [
      {
        id: "s1",
        type: "line_range",
        location: "lines:2-3",
        reason: "not_selected",
        recoverable: true,
      },
      {
        id: "s2",
        type: "duplicate_block",
        location: "lines:1-1;lines:5-5",
        reason: "duplicate",
        recoverable: true,
        occurrences: 3,
      },
      {
        id: "s3",
        type: "line_range",
        location: "offset:0-5",
        reason: "not_selected",
        recoverable: true,
      },
    ];
    const { get } = await setup(text, "text", segments);
    expect(await get({ selector: { type: "segment_id", value: "s1" } })).toMatchObject({
      content: "beta ERROR one\ngamma\n",
    });
    expect(await get({ selector: { type: "segment_id", value: "s2" } })).toMatchObject({
      content: "alpha\r\n\nepsilon\n",
      matches: [
        { location: "lines:1-1", text: "alpha\r\n" },
        { location: "lines:5-5", text: "epsilon\n" },
      ],
    });
    expect(await get({ selector: { type: "segment_id", value: "s3" } })).toMatchObject({
      content: "alpha",
    });
    expect((await get({ selector: { type: "segment_id", value: "s9" } })).status).toBe(
      "INVALID_SELECTOR",
    );
  });

  it("resolves JSON and MCP block segments", async () => {
    const json = '{"a":{"b":[1,2]}}';
    const jsonCase = await setup(json, "json", [
      {
        id: "s1",
        type: "json_value",
        location: "json:$['a']['b']",
        reason: "not_selected",
        recoverable: true,
      },
    ]);
    expect(await jsonCase.get({ selector: { type: "segment_id", value: "s1" } })).toMatchObject({
      content: "[\n  1,\n  2\n]",
    });

    const blocks = [
      { type: "text", text: "first\nsecond\nthird\n" },
      { type: "image", data: "AA==", mimeType: "image/png" },
    ];
    const mcp = await setup(canonicalJson(blocks), "mcp_content", [
      {
        id: "s1",
        type: "line_range",
        location: "block:0/lines:2-3",
        reason: "not_selected",
        recoverable: true,
      },
      {
        id: "s2",
        type: "line_range",
        location: "block:1/lines:1-1",
        reason: "not_selected",
        recoverable: true,
      },
    ]);
    expect(await mcp.get({ selector: { type: "segment_id", value: "s1" } })).toMatchObject({
      content: "second\nthird\n",
      matches: [{ location: "block:0/lines:2-3", text: "second\nthird\n" }],
    });
    expect((await mcp.get({ selector: { type: "segment_id", value: "s2" } })).status).toBe(
      "INTEGRITY_ERROR",
    );
    expect((await mcp.get({ selector: { type: "line_range", value: "1-1" } })).status).toBe(
      "INVALID_SELECTOR",
    );
  });
});

describe("retrieveContext — size limits", () => {
  it("returns TOO_LARGE instead of truncating non-keyword results", async () => {
    const { get } = await setup("x".repeat(400));
    expect(await get({ maxTokens: 10 })).toMatchObject({
      status: "TOO_LARGE",
      message: "Result is too large (100 tokens exceeds maxTokens 10); use a narrower selector",
    });
    expect((await get({}, scope, { maxResponseBytes: 100 })).status).toBe("TOO_LARGE");
    expect((await get({ maxTokens: 100 })).status).toBe("OK");
  });
});
