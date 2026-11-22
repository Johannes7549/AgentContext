import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OmittedSegment, OptimizationEvent } from "@agentcontext/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ContextRecord,
  MetadataStore,
  MIGRATIONS,
  migrate,
  openDatabase,
} from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "agentcontext-meta-"));
  dirs.push(dir);
  return join(dir, "agentcontext.db");
}

const tokenizer = { id: "fallback-estimator", version: "1.0.0", isExact: false };
const context = (id: string, overrides: Partial<ContextRecord> = {}): ContextRecord => ({
  contextId: id,
  workspaceId: "ws",
  sessionId: "s1",
  contentHash: "a".repeat(64),
  contentType: "logs",
  source: "command:test",
  sizeBytes: 100,
  createdAt: new Date(1_000),
  expiresAt: new Date(10_000),
  blobRef: null,
  inlineContent: "original",
  ...overrides,
});
const segments: OmittedSegment[] = [
  {
    id: "s1",
    type: "log_group",
    location: "lines:2-9",
    reason: "repeated_log_line",
    recoverable: true,
    occurrences: 9,
  },
  {
    id: "s2",
    type: "line_range",
    location: "lines:10-12",
    reason: "not_selected",
    recoverable: false,
    note: "n",
  },
];

describe("openDatabase and migrations", () => {
  it("creates the schema with WAL on a file database", () => {
    const db = openDatabase(tempDb());
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "context_variants",
        "contexts",
        "omitted_segments",
        "optimization_events",
        "schema_migrations",
      ]),
    );
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe(
      "wal",
    );
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(
      1,
    );
    db.close();
  });

  it("is idempotent and records the schema version", () => {
    const path = tempDb();
    openDatabase(path).close();
    const db = openDatabase(path);
    expect(migrate(db)).toBe(MIGRATIONS.at(-1)?.version);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toEqual([{ version: 1 }]);
    db.close();
  });

  it("refuses a database from a newer schema version", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (999, 0)").run();
    expect(() => migrate(db)).toThrow(expect.objectContaining({ code: "STORAGE_ERROR" }));
  });
});

describe("MetadataStore", () => {
  const store = () => new MetadataStore(openDatabase(":memory:"));

  it("round-trips contexts", () => {
    const s = store();
    s.insertContext(context("ctx_1"));
    expect(s.getContext("ctx_1")).toEqual(context("ctx_1"));
    expect(s.getContext("missing")).toBeNull();
  });

  it("requires exactly one of blob_ref and inline_content", () => {
    const s = store();
    expect(() => s.insertContext(context("a", { blobRef: "x", inlineContent: "y" }))).toThrow();
    expect(() => s.insertContext(context("b", { blobRef: null, inlineContent: null }))).toThrow();
    s.insertContext(context("c", { blobRef: "ab/abc", inlineContent: null }));
    expect(s.getContext("c")?.blobRef).toBe("ab/abc");
  });

  it("stores variants with ordered segments and returns the latest variant's segments", () => {
    const s = store();
    s.insertContext(context("ctx_1"));
    s.insertVariant(variant("var_1", 1), segments);
    expect(s.getLatestSegments("ctx_1")).toEqual(segments);
    s.insertVariant(variant("var_2", 2), [segments[0] as OmittedSegment]);
    expect(s.getLatestSegments("ctx_1")).toEqual([segments[0]]);
    expect(s.countVariants("ctx_1")).toBe(2);
    expect(s.getLatestSegments("missing")).toEqual([]);
  });

  it("writes a variant and its segments atomically", () => {
    const s = store();
    s.insertContext(context("ctx_1"));
    const duplicate = [segments[0], segments[0]] as OmittedSegment[];
    expect(() => s.insertVariant(variant("var_1", 1), duplicate)).toThrow();
    expect(s.countVariants("ctx_1")).toBe(0);
  });

  it("rejects variants for unknown contexts (foreign key)", () => {
    expect(() => store().insertVariant(variant("var_x", 1, "nope"), [])).toThrow();
  });

  it("deletes contexts with cascading variants and segments", () => {
    const s = store();
    s.insertContext(context("ctx_1"));
    s.insertVariant(variant("var_1", 1), segments);
    expect(s.deleteContexts(["ctx_1", "missing"]).map((c) => c.contextId)).toEqual(["ctx_1"]);
    expect(s.getContext("ctx_1")).toBeNull();
    expect(s.getLatestSegments("ctx_1")).toEqual([]);
    expect(s.deleteContexts([])).toEqual([]);
  });

  it("supports expiry, age, size and blob reference queries", () => {
    const s = store();
    s.insertContext(
      context("old", { createdAt: new Date(1), expiresAt: new Date(5), sizeBytes: 10 }),
    );
    s.insertContext(
      context("new", {
        createdAt: new Date(2),
        expiresAt: new Date(50),
        sizeBytes: 20,
        blobRef: "ab/x",
        inlineContent: null,
      }),
    );
    expect(s.expiredContextIds(new Date(5))).toEqual(["old"]);
    expect(s.contextsByAge()).toEqual([
      { id: "old", sizeBytes: 10 },
      { id: "new", sizeBytes: 20 },
    ]);
    expect(s.totalSizeBytes()).toBe(30);
    expect(s.isBlobReferenced("ab/x")).toBe(true);
    expect(s.isBlobReferenced("ab/y")).toBe(false);
    expect(s.referencedBlobRefs()).toEqual(new Set(["ab/x"]));
  });

  it("records and filters events without raw content", () => {
    const s = store();
    const event = (createdAt: number): OptimizationEvent => ({
      contextId: null,
      eventType: "optimized",
      strategy: "log-compressor",
      originalTokens: 100,
      optimizedTokens: 40,
      recoveredTokens: 0,
      tokenizer,
      processingTimeMs: 1.5,
      createdAt: new Date(createdAt),
    });
    s.insertEvent(event(1_000), "s1");
    s.insertEvent(event(2_000), "s2");
    expect(s.listEvents()).toEqual([event(1_000), event(2_000)]);
    expect(s.listEvents({ since: new Date(1_500) })).toEqual([event(2_000)]);
    expect(s.listEvents({ sessionId: "s1" })).toEqual([event(1_000)]);
  });
});

function variant(id: string, createdAt: number, contextId = "ctx_1") {
  return {
    variantId: id,
    contextId,
    strategy: "log-compressor",
    strategyVersion: "1.0.0",
    optimizedContent: "compact",
    originalTokens: 100,
    optimizedTokens: 40,
    tokenizer,
    createdAt: new Date(createdAt),
  };
}
