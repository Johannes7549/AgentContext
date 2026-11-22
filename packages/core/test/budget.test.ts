import type { RetrievalScope } from "@agentcontext/shared";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import {
  analyze,
  budgetWarning,
  createEngine,
  hasBudget,
  meetsBudget,
  normalize,
  StrategyRegistry,
  selectStrategy,
} from "../src/index.js";
import { fakeStrategy } from "./helpers/fake-strategy.js";
import { keepFirstLines } from "./helpers/line-range-strategy.js";
import { MemoryStorage } from "./helpers/memory-storage.js";

const tokenizer = new FallbackEstimator();
const scope: RetrievalScope = { workspaceId: "w", sessionId: "s", mode: "session" };
const log = Array.from(
  { length: 300 },
  (_, i) => `2026-11-22T10:00:00Z INFO request ${i} handled`,
).join("\n");

describe("budget rules", () => {
  it("detects whether a budget is set", () => {
    expect(hasBudget({})).toBe(false);
    expect(hasBudget({ maxTokens: 10 })).toBe(true);
    expect(hasBudget({ targetReduction: 0.5 })).toBe(true);
  });

  it.each([
    [{}, 100, 100, true],
    [{ maxTokens: 50 }, 100, 50, true],
    [{ maxTokens: 50 }, 100, 51, false],
    [{ targetReduction: 0.5 }, 100, 50, true],
    [{ targetReduction: 0.5 }, 100, 51, false],
    [{ targetReduction: 0.3 }, 0, 0, true],
    [{ maxTokens: 60, targetReduction: 0.5 }, 100, 55, false],
  ])("meetsBudget(%j, %i → %i) = %s", (options, original, output, expected) => {
    expect(meetsBudget(options, original, output)).toBe(expected);
  });

  it("describes every missed budget without content", () => {
    expect(budgetWarning({ maxTokens: 50, targetReduction: 0.6 }, 100, 70)).toEqual({
      code: "BUDGET_EXCEEDED",
      message:
        "Budget not met safely: content is 70 tokens, above maxTokens 50; reduction 30% is below targetReduction 60%. Nothing was truncated; use a selection to omit more, or retrieve parts on demand.",
    });
    expect(budgetWarning({ maxTokens: 50 }, 100, 40)).toBeUndefined();
    expect(budgetWarning({}, 100, 100)).toBeUndefined();
  });
});

describe("budget-aware selection", () => {
  async function select(options: Parameters<typeof selectStrategy>[2], content = log) {
    const context = normalize({ content, contentType: "logs", source: "t" });
    const analysis = await analyze(context, tokenizer);
    const registry = new StrategyRegistry([
      fakeStrategy({
        name: "big-saver-low",
        confidence: "low",
        saved: analysis.tokens.count - 100,
      }),
      fakeStrategy({ name: "small-saver-high", confidence: "high", saved: 200 }),
    ]);
    return { result: await selectStrategy(context, analysis, options, registry), analysis };
  }

  it("prefers a candidate that meets maxTokens over higher confidence", async () => {
    const { result } = await select({ maxTokens: 200 });
    expect(result.kind === "selected" && result.strategy.name).toBe("big-saver-low");
  });

  it("falls back to confidence ranking when no candidate meets the budget", async () => {
    const { result } = await select({ maxTokens: 10 });
    expect(result.kind === "selected" && result.strategy.name).toBe("small-saver-high");
  });

  it("skips content already within maxTokens unless a strategy or selection is explicit", async () => {
    const { result, analysis } = await select({ maxTokens: 1_000_000 });
    expect(result).toMatchObject({ kind: "skip", reason: "WITHIN_BUDGET" });
    expect(analysis.tokens.count).toBeLessThan(1_000_000);
    const forced = await select({ maxTokens: 1_000_000, strategy: "small-saver-high" });
    expect(forced.result.kind).toBe("selected");
  });

  it("does not skip within maxTokens when a targetReduction is also requested", async () => {
    const { result } = await select({ maxTokens: 1_000_000, targetReduction: 0.5 });
    expect(result.kind === "selected" && result.strategy.name).toBe("big-saver-low");
  });
});

describe("engine budget behaviour", () => {
  const engine = () =>
    createEngine({ tokenizer, strategies: [keepFirstLines(3)], storage: new MemoryStorage() });

  it("returns no budget warning when the optimized output fits", async () => {
    const result = await engine().optimize(
      { content: log, source: "s" },
      { maxTokens: 500 },
      scope,
    );
    expect(result.strategy).toBe("keep-first-lines");
    expect(result.metrics.optimizedTokens).toBeLessThanOrEqual(500);
    expect(result.warnings).toEqual([]);
  });

  it("warns instead of truncating when the optimized output is still over budget", async () => {
    const result = await engine().optimize({ content: log, source: "s" }, { maxTokens: 5 }, scope);
    expect(result.strategy).toBe("keep-first-lines");
    expect(result.metrics.optimizedTokens).toBeGreaterThan(5);
    expect(result.warnings.map((w) => w.code)).toEqual(["BUDGET_EXCEEDED"]);
  });

  it("warns on passthrough results that miss the budget", async () => {
    const none = createEngine({ tokenizer, strategies: [] });
    const result = await none.optimize({ content: log, source: "s" }, { maxTokens: 10 });
    expect(result.strategy).toBe("passthrough");
    expect(result.content).toBe(log);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "NO_SUPPORTED_STRATEGY",
      "BUDGET_EXCEEDED",
    ]);
  });

  it("reports an unmet targetReduction", async () => {
    const result = await engine().optimize(
      { content: log, source: "s" },
      { targetReduction: 0.999 },
      scope,
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "BUDGET_EXCEEDED",
        message: expect.stringContaining("targetReduction 99.9%"),
      }),
    ]);
  });

  it("returns small content unchanged with no warning when it fits the budget", async () => {
    const result = await engine().optimize(
      { content: log, source: "s" },
      { maxTokens: 1_000_000 },
      scope,
    );
    expect(result).toMatchObject({ strategy: "passthrough", warnings: [] });
  });
});
