import {
  CompressionResultSchema,
  type ContentBlock,
  type RetrievalScope,
  sha256Hex,
} from "@agentcontext/shared";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import {
  createEngine,
  type EngineConfig,
  type EngineDependencies,
  newContextId,
  ulid,
} from "../src/index.js";
import { fakeStrategy } from "./helpers/fake-strategy.js";
import { keepFirstLines } from "./helpers/line-range-strategy.js";
import { MemoryStorage } from "./helpers/memory-storage.js";

const tokenizer = new FallbackEstimator();
const scope: RetrievalScope = { workspaceId: "ws", sessionId: "sess-1", mode: "session" };
const log = Array.from(
  { length: 300 },
  (_, i) => `2026-11-22T10:00:00Z INFO request ${i} handled`,
).join("\n");
const fixedNow = new Date("2026-11-22T12:00:00Z");
let counter = 0;
const config: Partial<EngineConfig> = {
  now: () => fixedNow,
  randomBytes: () => new Uint8Array(10).fill(++counter % 256),
};

const engineWith = (overrides: Partial<EngineDependencies> = {}) =>
  createEngine({ tokenizer, strategies: [keepFirstLines()], config, ...overrides });

describe("ids", () => {
  it("creates sortable ULID-based context ids", () => {
    const zero = () => new Uint8Array(10);
    expect(ulid(new Date(0), zero)).toBe("00000000000000000000000000");
    expect(ulid(new Date(1), () => new Uint8Array(10).fill(255))).toBe(
      "0000000001ZZZZZZZZZZZZZZZZ",
    );
    const a = newContextId(new Date(1000));
    const b = newContextId(new Date(2000));
    expect(a < b).toBe(true);
    expect(a).toMatch(/^ctx_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("createEngine — optimize without storage", () => {
  it("returns the original unchanged when content is below the threshold", async () => {
    const result = await engineWith().optimize({ content: "small", source: "s" });
    expect(result).toMatchObject({
      contextId: null,
      content: "small",
      strategy: "passthrough",
      recoveryAvailable: false,
      omittedSegments: [],
      warnings: [],
    });
    expect(result.metrics.savedTokens).toBe(0);
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
  });

  it("refuses recoverable omissions without storage unless allowLossy is set", async () => {
    const refused = await engineWith().optimize({ content: log, source: "s" });
    expect(refused.strategy).toBe("passthrough");
    expect(refused.content).toBe(log);
    expect(refused.warnings.map((w) => w.code)).toEqual(["LOSSY_OMISSION"]);

    const lossy = await engineWith().optimize({ content: log, source: "s" }, { allowLossy: true });
    expect(lossy.strategy).toBe("keep-first-lines");
    expect(lossy.recoveryAvailable).toBe(false);
    expect(lossy.omittedSegments.every((s) => !s.recoverable)).toBe(true);
    expect(lossy.warnings.map((w) => w.code)).toEqual(["LOSSY_OMISSION"]);
    expect(lossy.metrics.savedTokens).toBeGreaterThan(0);
    expect(CompressionResultSchema.safeParse(lossy).success).toBe(true);
  });

  it("warns when no strategy supports the content", async () => {
    const engine = createEngine({
      tokenizer,
      strategies: [fakeStrategy({ name: "j", types: ["json"] })],
      config,
    });
    const result = await engine.optimize({ content: log, source: "s" });
    expect(result.strategy).toBe("passthrough");
    expect(result.warnings.map((w) => w.code)).toEqual(["NO_SUPPORTED_STRATEGY"]);
  });

  it("passes MCP content blocks through unchanged", async () => {
    const content: ContentBlock[] = [
      { type: "text", text: log },
      { type: "image", data: "AA==", mimeType: "image/png" },
    ];
    const result = await engineWith().optimize({ content, source: "s" });
    expect(result.content).toEqual(content);
    expect(result.warnings.map((w) => w.code)).toEqual(["NO_SUPPORTED_STRATEGY"]);
  });

  it("falls back when the strategy throws", async () => {
    const broken = fakeStrategy({
      name: "broken",
      compress: () => {
        throw new Error("boom");
      },
    });
    const result = await createEngine({ tokenizer, strategies: [broken], config }).optimize({
      content: log,
      source: "s",
    });
    expect(result).toMatchObject({ content: log, strategy: "passthrough" });
    expect(result.warnings).toEqual([
      { code: "VALIDATION_FAILED", message: 'Strategy "broken" failed (Error)' },
    ]);
  });

  it("falls back when the output is not smaller", async () => {
    const same = fakeStrategy({ name: "same" });
    const result = await createEngine({ tokenizer, strategies: [same], config }).optimize({
      content: log,
      source: "s",
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["NO_BENEFIT"]);
  });

  it("falls back when validation fails and never returns the invalid output", async () => {
    const liar = fakeStrategy({
      name: "liar",
      compress: () => ({ content: "tiny", omittedSegments: [], warnings: [] }),
    });
    const result = await createEngine({ tokenizer, strategies: [liar], config }).optimize({
      content: log,
      source: "s",
    });
    expect(result.content).toBe(log);
    expect(result.warnings[0]?.code).toBe("VALIDATION_FAILED");
    expect(result.warnings[0]?.message).toContain("UNACCOUNTED_REDUCTION");
  });

  it("rejects invalid options and input", async () => {
    await expect(
      engineWith().optimize({ content: log, source: "s" }, { maxTokens: -1 }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(engineWith().optimize({ content: 5, source: "s" } as never)).rejects.toMatchObject(
      {
        code: "INVALID_INPUT",
      },
    );
    await expect(
      createEngine({
        tokenizer,
        strategies: [],
        config: { ...config, maxInputBytes: 10 },
      }).optimize({
        content: log,
        source: "s",
      }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
  });

  it("is deterministic apart from ids and timing", async () => {
    const strip = (r: Awaited<ReturnType<ReturnType<typeof engineWith>["optimize"]>>) => ({
      ...r,
      metrics: { ...r.metrics, processingTimeMs: 0 },
    });
    const a = await engineWith().optimize({ content: log, source: "s" }, { allowLossy: true });
    const b = await engineWith().optimize({ content: log, source: "s" }, { allowLossy: true });
    expect(strip(a)).toEqual(strip(b));
  });
});

describe("createEngine — optimize with storage", () => {
  it("persists and verifies the original before reporting recovery", async () => {
    const storage = new MemoryStorage();
    const result = await engineWith({ storage }).optimize(
      { content: log, source: "file:app.log" },
      {},
      scope,
    );
    expect(result.recoveryAvailable).toBe(true);
    expect(result.contextId).toMatch(/^ctx_/);
    expect(result.omittedSegments.every((s) => s.recoverable)).toBe(true);
    const id = result.contextId as string;
    expect(storage.hashOf(id)).toBe(sha256Hex(log));
    expect(storage.contexts.get(id)).toMatchObject({
      workspaceId: "ws",
      sessionId: "sess-1",
      source: "file:app.log",
      expiresAt: new Date(fixedNow.getTime() + 7 * 24 * 3600 * 1000),
    });
    expect(storage.variants.get(id)).toMatchObject({
      strategy: "keep-first-lines",
      strategyVersion: "1.0.0",
    });
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
  });

  it("requires a scope when storage is configured", async () => {
    await expect(
      engineWith({ storage: new MemoryStorage() }).optimize({ content: log, source: "s" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it.each([
    ["putOriginal fails", { failPutOriginal: true }],
    ["putVariant fails", { failPutVariant: true }],
    ["stored bytes are corrupted", { corrupt: true }],
  ])("returns the original when %s (default policy)", async (_name, faults) => {
    const result = await engineWith({ storage: new MemoryStorage(faults) }).optimize(
      { content: log, source: "s" },
      {},
      scope,
    );
    expect(result).toMatchObject({
      content: log,
      strategy: "passthrough",
      recoveryAvailable: false,
      contextId: null,
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["STORAGE_FAILED"]);
  });

  it("returns a non-recoverable result under the non_recoverable policy", async () => {
    const engine = engineWith({
      storage: new MemoryStorage({ corrupt: true }),
      config: { ...config, storageFailurePolicy: "non_recoverable" },
    });
    const result = await engine.optimize({ content: log, source: "s" }, {}, scope);
    expect(result.strategy).toBe("keep-first-lines");
    expect(result.recoveryAvailable).toBe(false);
    expect(result.contextId).toBeNull();
    expect(result.omittedSegments.every((s) => !s.recoverable)).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["STORAGE_FAILED"]);
  });
});

describe("createEngine — retrieve and stats", () => {
  it("retrieves the full original within scope", async () => {
    const storage = new MemoryStorage();
    const engine = engineWith({ storage });
    const { contextId } = await engine.optimize({ content: log, source: "s" }, {}, scope);
    const result = await engine.retrieve({ contextId: contextId as string }, scope);
    expect(result).toMatchObject({ status: "OK", content: log, truncated: false });
  });

  it("enforces scope, expiry, integrity and size", async () => {
    const storage = new MemoryStorage();
    let now = fixedNow;
    const engine = engineWith({ storage, config: { ...config, now: () => now } });
    const { contextId } = await engine.optimize({ content: log, source: "s" }, {}, scope);
    const id = contextId as string;

    expect(
      (await engine.retrieve({ contextId: id }, { ...scope, sessionId: "other" })).status,
    ).toBe("UNAUTHORIZED");
    expect(
      (
        await engine.retrieve(
          { contextId: id },
          { ...scope, sessionId: "other", mode: "workspace" },
        )
      ).status,
    ).toBe("OK");
    expect(
      (await engine.retrieve({ contextId: id }, { ...scope, workspaceId: "w2", mode: "workspace" }))
        .status,
    ).toBe("UNAUTHORIZED");
    expect((await engine.retrieve({ contextId: id, maxTokens: 5 }, scope)).status).toBe(
      "TOO_LARGE",
    );
    expect((await engine.retrieve({ contextId: newContextId() }, scope)).status).toBe("NOT_FOUND");
    expect(
      (
        await engine.retrieve(
          { contextId: id, selector: { type: "line_range", value: "1-2" } },
          scope,
        )
      ).status,
    ).toBe("INVALID_SELECTOR");

    storage.faults.corrupt = true;
    expect((await engine.retrieve({ contextId: id }, scope)).status).toBe("INTEGRITY_ERROR");
    storage.faults.corrupt = false;

    now = new Date(fixedNow.getTime() + 8 * 24 * 3600 * 1000);
    expect((await engine.retrieve({ contextId: id }, scope)).status).toBe("EXPIRED");
  });

  it("reports NOT_FOUND without storage", async () => {
    expect((await engineWith().retrieve({ contextId: newContextId() }, scope)).status).toBe(
      "NOT_FOUND",
    );
  });

  it("aggregates stats including recovered tokens", async () => {
    const storage = new MemoryStorage();
    const engine = engineWith({ storage });
    const optimized = await engine.optimize({ content: log, source: "s" }, {}, scope);
    await engine.optimize({ content: "tiny", source: "s" }, {}, scope);
    const recovered = await engine.retrieve({ contextId: optimized.contextId as string }, scope);
    const stats = await engine.stats();
    expect(stats).toMatchObject({ optimizations: 1, skipped: 1, fallbacks: 0, retrievals: 1 });
    expect(stats.recoveredTokens).toBe(recovered.status === "OK" ? recovered.tokens.count : -1);
    expect(stats.netSavedTokens).toBe(
      stats.originalTokens - stats.optimizedTokens - stats.recoveredTokens,
    );
    expect((await engine.stats({ sessionId: "nobody" })).optimizations).toBe(0);
    expect((await engine.stats({ since: new Date(fixedNow.getTime() + 1) })).optimizations).toBe(0);
  });

  it("ignores failing event sinks", async () => {
    const engine = engineWith({
      events: {
        record: () => {
          throw new Error("sink down");
        },
      },
    });
    await expect(engine.optimize({ content: "x", source: "s" })).resolves.toMatchObject({
      strategy: "passthrough",
    });
  });
});
