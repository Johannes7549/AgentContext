import { AgentContextError, type CompressionOptions } from "@agentcontext/shared";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import { analyze, normalize, StrategyRegistry, selectStrategy } from "../src/index.js";
import { fakeStrategy } from "./helpers/fake-strategy.js";

const tokenizer = new FallbackEstimator();
const bigLog = "2026-11-22T10:00:00Z INFO request handled in 12ms\n".repeat(200);

async function setup(content = bigLog, contentType: "logs" | "json" | "text" = "logs") {
  const context = normalize({ content, contentType, source: "test" });
  return { context, analysis: await analyze(context, tokenizer) };
}

async function select(
  registry: StrategyRegistry,
  options: CompressionOptions = {},
  content?: string,
) {
  const { context, analysis } = await setup(content);
  return selectStrategy(context, analysis, options, registry, {
    minOptimizeTokens: 500,
    minBenefitTokens: 50,
  });
}

describe("StrategyRegistry", () => {
  it("registers, lists in order and looks up strategies", () => {
    const a = fakeStrategy({ name: "a" });
    const b = fakeStrategy({ name: "b" });
    const registry = new StrategyRegistry([a]).register(b);
    expect(registry.names()).toEqual(["a", "b"]);
    expect(registry.get("b")).toBe(b);
    expect(registry.has("c")).toBe(false);
  });

  it.each(["", "passthrough"])("rejects reserved or empty name %j", (name) => {
    expect(() => new StrategyRegistry([fakeStrategy({ name })])).toThrow(AgentContextError);
  });

  it("rejects duplicates and unknown names", () => {
    expect(
      () => new StrategyRegistry([fakeStrategy({ name: "a" }), fakeStrategy({ name: "a" })]),
    ).toThrow(AgentContextError);
    expect(() => new StrategyRegistry().get("zzz")).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });
});

describe("selectStrategy", () => {
  it("skips content below the size threshold without consulting strategies", async () => {
    const s = fakeStrategy({ name: "a" });
    const result = await select(new StrategyRegistry([s]), {}, "small log line\n");
    expect(result).toMatchObject({ kind: "skip", reason: "BELOW_THRESHOLD" });
    expect(s.calls).toEqual([]);
  });

  it("lets explicit selections and forced strategies bypass the size threshold", async () => {
    const s = fakeStrategy({ name: "a", saved: 60 });
    const registry = new StrategyRegistry([s]);
    const small = "2026-11-22T10:00:00Z INFO x\n";
    expect(await select(registry, { strategy: "a", minBenefitTokens: 0 }, small)).toMatchObject({
      kind: "selected",
    });
    expect(
      await select(
        registry,
        { selection: { lines: { ranges: [{ start: 1, end: 1 }] } }, minBenefitTokens: 0 },
        small,
      ),
    ).toMatchObject({ kind: "selected" });
  });

  it("reports NO_SUPPORTED_STRATEGY when nothing supports the type", async () => {
    const result = await select(
      new StrategyRegistry([fakeStrategy({ name: "j", types: ["json"] })]),
    );
    expect(result).toMatchObject({ kind: "skip", reason: "NO_SUPPORTED_STRATEGY" });
  });

  it("reports NO_BENEFIT when savings are below the minimum", async () => {
    const result = await select(new StrategyRegistry([fakeStrategy({ name: "a", saved: 10 })]));
    expect(result).toMatchObject({ kind: "skip", reason: "NO_BENEFIT" });
  });

  it("honours options.minBenefitTokens over the default", async () => {
    const registry = new StrategyRegistry([fakeStrategy({ name: "a", saved: 10 })]);
    expect(await select(registry, { minBenefitTokens: 5 })).toMatchObject({ kind: "selected" });
  });

  it("ignores non-applicable strategies", async () => {
    const result = await select(
      new StrategyRegistry([fakeStrategy({ name: "a", applicable: false })]),
    );
    expect(result).toMatchObject({ kind: "skip", reason: "NO_BENEFIT" });
  });

  it("ranks by confidence, then saving, then registration order", async () => {
    const registry = new StrategyRegistry([
      fakeStrategy({ name: "low-big", confidence: "low", saved: 900 }),
      fakeStrategy({ name: "high-small", confidence: "high", saved: 100 }),
      fakeStrategy({ name: "high-big", confidence: "high", saved: 300 }),
      fakeStrategy({ name: "high-big-later", confidence: "high", saved: 300 }),
    ]);
    const result = await select(registry);
    expect(result.kind === "selected" && result.strategy.name).toBe("high-big");
    expect(result.candidates.map((c) => c.strategy)).toEqual([
      "low-big",
      "high-small",
      "high-big",
      "high-big-later",
    ]);
  });

  it("treats throwing strategies as unavailable", async () => {
    const registry = new StrategyRegistry([
      fakeStrategy({ name: "boom", analyzeThrows: true }),
      fakeStrategy({ name: "bad-supports", supportsThrows: true }),
      fakeStrategy({ name: "ok", saved: 80 }),
    ]);
    const result = await select(registry);
    expect(result.kind === "selected" && result.strategy.name).toBe("ok");
    expect(result.candidates).toContainEqual({
      strategy: "boom",
      supported: true,
      error: "TypeError",
    });
    expect(result.candidates).toContainEqual({ strategy: "bad-supports", supported: false });
  });

  it("uses only the forced strategy", async () => {
    const other = fakeStrategy({ name: "other", saved: 999 });
    const forced = fakeStrategy({ name: "forced", saved: 60, confidence: "low" });
    const result = await select(new StrategyRegistry([other, forced]), { strategy: "forced" });
    expect(result.kind === "selected" && result.strategy.name).toBe("forced");
    expect(other.calls).toEqual([]);
  });

  it("skips when the forced strategy does not support the content", async () => {
    const forced = fakeStrategy({ name: "json-only", types: ["json"] });
    const result = await select(new StrategyRegistry([forced]), { strategy: "json-only" });
    expect(result).toMatchObject({ kind: "skip", reason: "FORCED_STRATEGY_UNSUPPORTED" });
  });

  it("throws INVALID_INPUT for an unknown forced strategy", async () => {
    await expect(select(new StrategyRegistry(), { strategy: "nope" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("is deterministic", async () => {
    const registry = new StrategyRegistry([
      fakeStrategy({ name: "a", saved: 200 }),
      fakeStrategy({ name: "b", saved: 200 }),
    ]);
    const first = await select(registry);
    const second = await select(registry);
    expect(first.kind === "selected" && first.strategy.name).toBe("a");
    expect(second.kind === "selected" && second.strategy.name).toBe("a");
  });
});
