import { AgentContextError, type Tokenizer } from "@agentcontext/shared";
import { describe, expect, it } from "vitest";
import {
  countTokens,
  createDefaultRegistry,
  DEFAULT_TOKENIZER_ID,
  FallbackEstimator,
  TokenizerRegistry,
  tokenizerInfo,
} from "../src/index.js";

const exactFake: Tokenizer = {
  id: "exact-fake",
  version: "0.1.0",
  isExact: true,
  countTokens: async (text) => text.length,
};

describe("countTokens", () => {
  it("labels counts with tokenizer identity", async () => {
    await expect(countTokens(new FallbackEstimator(), "hello world")).resolves.toEqual({
      count: 4,
      tokenizer: { id: "fallback-estimator", version: "1.0.0", isExact: false },
    });
  });

  it("supports async tokenizers", async () => {
    await expect(countTokens(exactFake, "abc")).resolves.toEqual({
      count: 3,
      tokenizer: { id: "exact-fake", version: "0.1.0", isExact: true },
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid count %s",
    async (bad) => {
      const broken: Tokenizer = { ...exactFake, countTokens: () => bad };
      await expect(countTokens(broken, "x")).rejects.toMatchObject({ code: "INTERNAL" });
    },
  );
});

describe("TokenizerRegistry", () => {
  it("contains the fallback estimator by default", () => {
    const registry = createDefaultRegistry();
    expect(registry.has(DEFAULT_TOKENIZER_ID)).toBe(true);
    expect(registry.get(DEFAULT_TOKENIZER_ID)).toBeInstanceOf(FallbackEstimator);
    expect(registry.list()).toEqual([tokenizerInfo(new FallbackEstimator())]);
  });

  it("registers additional tokenizers", () => {
    const registry = createDefaultRegistry().register(exactFake);
    expect(registry.get("exact-fake")).toBe(exactFake);
    expect(registry.list().map((t) => t.id)).toEqual(["fallback-estimator", "exact-fake"]);
  });

  it("rejects duplicate ids", () => {
    expect(() => createDefaultRegistry().register(new FallbackEstimator())).toThrow(
      AgentContextError,
    );
  });

  it("reports unknown ids with the available list", () => {
    try {
      new TokenizerRegistry().register(exactFake).get("cl100k");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        details: { tokenizer: "cl100k", available: ["exact-fake"] },
      });
    }
  });
});
