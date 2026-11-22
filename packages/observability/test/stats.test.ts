import type { OptimizationEvent } from "@agentcontext/shared";
import { describe, expect, it } from "vitest";
import { aggregateStats, createPersistentEventSink, type EventStore } from "../src/index.js";

const tokenizer = { id: "fallback-estimator", version: "1.0.0", isExact: false };
const event = (overrides: Partial<OptimizationEvent>): OptimizationEvent => ({
  contextId: null,
  eventType: "optimized",
  strategy: "log-compressor",
  originalTokens: 0,
  optimizedTokens: 0,
  recoveredTokens: 0,
  tokenizer,
  processingTimeMs: 1,
  createdAt: new Date(0),
  ...overrides,
});

describe("aggregateStats", () => {
  it("counts event types and sums tokens including recovery", () => {
    const stats = aggregateStats(
      [
        event({ originalTokens: 1000, optimizedTokens: 200 }),
        event({ eventType: "skipped", originalTokens: 50, optimizedTokens: 50 }),
        event({ eventType: "fallback", originalTokens: 300, optimizedTokens: 300 }),
        event({ eventType: "retrieved", recoveredTokens: 150 }),
        event({ eventType: "storage_failed", originalTokens: 999, optimizedTokens: 1 }),
      ],
      tokenizer,
    );
    expect(stats).toEqual({
      optimizations: 1,
      skipped: 1,
      fallbacks: 1,
      retrievals: 1,
      originalTokens: 1350,
      optimizedTokens: 550,
      recoveredTokens: 150,
      netSavedTokens: 1350 - 550 - 150,
      tokenizer,
    });
  });

  it("never mixes token counts from a different tokenizer", () => {
    const other = { id: "tiktoken", version: "1", isExact: true };
    const stats = aggregateStats(
      [
        event({ originalTokens: 100, optimizedTokens: 10 }),
        event({ tokenizer: other, originalTokens: 999 }),
      ],
      tokenizer,
    );
    expect(stats.originalTokens).toBe(100);
    expect(stats.optimizations).toBe(2);
  });

  it("reports negative net savings when recovery exceeds savings", () => {
    const stats = aggregateStats(
      [
        event({ originalTokens: 100, optimizedTokens: 90 }),
        event({ eventType: "retrieved", recoveredTokens: 100 }),
      ],
      tokenizer,
    );
    expect(stats.netSavedTokens).toBe(-90);
  });
});

describe("createPersistentEventSink", () => {
  it("persists events with the session id and logs without content", () => {
    const stored: [OptimizationEvent, string | null | undefined][] = [];
    const store: EventStore = {
      insertEvent: (e, s) => stored.push([e, s]),
      listEvents: () => stored.map(([e]) => e),
    };
    const logs: unknown[] = [];
    const logger = {
      debug: (_m: string, f?: Record<string, unknown>) => logs.push(f),
      info: () => {},
      warn: () => {},
      error: () => {},
      child: () => logger,
    };
    const sink = createPersistentEventSink({ store, sessionId: "sess-1", logger });
    const e = event({ originalTokens: 10 });
    sink.record(e);
    expect(stored).toEqual([[e, "sess-1"]]);
    expect(logs[0]).toMatchObject({ eventType: "optimized", originalTokens: 10 });
  });

  it("logs and swallows persistence failures", () => {
    const warnings: string[] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
      child: () => logger,
    };
    const sink = createPersistentEventSink({
      store: {
        insertEvent: () => {
          throw new Error("disk full");
        },
        listEvents: () => [],
      },
      sessionId: "s",
      logger,
    });
    expect(() => sink.record(event({}))).not.toThrow();
    expect(warnings).toEqual(["Could not persist optimization event"]);
  });
});
