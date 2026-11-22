import { createEngine } from "@agentcontext/core";
import { CompressionResultSchema, parseLocations, type RetrievalScope } from "@agentcontext/shared";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import { keepFirstLines } from "../../packages/core/test/helpers/line-range-strategy.js";
import { MemoryStorage } from "../../packages/core/test/helpers/memory-storage.js";

const scope: RetrievalScope = { workspaceId: "integration", sessionId: "s1", mode: "session" };
const buildLog = Array.from(
  { length: 400 },
  (_, i) => `2026-11-22T10:00:${String(i % 60).padStart(2, "0")}Z INFO step ${i} ok`,
).join("\r\n");

describe("optimization pipeline (core + shared + tokenization)", () => {
  it("optimizes, stores, and recovers the exact original", async () => {
    const storage = new MemoryStorage();
    const engine = createEngine({
      tokenizer: new FallbackEstimator(),
      strategies: [keepFirstLines(5)],
      storage,
    });

    const result = await engine.optimize({ content: buildLog, source: "command:build" }, {}, scope);
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
    expect(result.recoveryAvailable).toBe(true);
    expect(result.metrics.tokenizer).toEqual({
      id: "fallback-estimator",
      version: "1.0.0",
      isExact: false,
    });
    expect(result.metrics.optimizedTokens).toBeLessThan(result.metrics.originalTokens);

    const [segment] = result.omittedSegments;
    expect(parseLocations(segment?.location ?? "")).toEqual([
      { kind: "lines", start: 6, end: 400 },
    ]);

    const recovered = await engine.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(buildLog);

    const stats = await engine.stats();
    expect(stats.netSavedTokens).toBe(
      stats.originalTokens - stats.optimizedTokens - stats.recoveredTokens,
    );
  });

  it("returns the original unchanged for small or unsupported content", async () => {
    const engine = createEngine({
      tokenizer: new FallbackEstimator(),
      strategies: [keepFirstLines(5)],
    });
    const result = await engine.optimize({ content: "one line", source: "s" });
    expect(result).toMatchObject({
      content: "one line",
      strategy: "passthrough",
      recoveryAvailable: false,
    });
  });
});
