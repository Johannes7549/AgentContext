import { describe, expect, it } from "vitest";
import { FallbackEstimator } from "../src/index.js";

const estimator = new FallbackEstimator();
const count = (text: string) => estimator.countTokens(text);

describe("FallbackEstimator — identity", () => {
  it("is labelled as an estimate", () => {
    expect(estimator.id).toBe("fallback-estimator");
    expect(estimator.version).toBe("1.0.0");
    expect(estimator.isExact).toBe(false);
  });
});

describe("FallbackEstimator — formula", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["abcd", 1],
    ["abcde", 2],
    ["hello world", 4], // "hello"=2, " "=0, "world"=2
    ["hello  world", 5], // double space = 1
    ["a\nb", 3], // a, newline run, b
    ["a\n\n\nb", 3], // newline runs count once
    ["{}", 2],
    ['{"id":1}', 7], // { " id " : 1 } — seven single pieces
    ["日本語", 3],
    ["привет", 3], // 6 code points / 2
    ["😀", 2],
    ["é", 1],
    ["    indent", 3], // 4 spaces = 1, "indent" = 2
  ])("estimates %j as %i", (text, expected) => {
    expect(count(text)).toBe(expected);
  });
});

describe("FallbackEstimator — properties", () => {
  const samples = [
    "The quick brown fox jumps over the lazy dog.",
    "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    '{"users":[{"id":1,"email":"a@example.com"},{"id":2,"email":"b@example.com"}]}',
    "2026-11-22T10:00:02Z ERROR connection refused\n    at connect (net.js:10:5)\n",
    "# Title\n\nSome *markdown* with a [link](https://example.com).\n",
  ];

  it("is deterministic", () => {
    for (const text of samples) expect(count(text)).toBe(count(text));
  });

  it("stays within plausible bounds for ASCII text (chars/8 .. chars)", () => {
    for (const text of samples) {
      const tokens = count(text);
      expect(tokens).toBeGreaterThanOrEqual(Math.floor(text.length / 8));
      expect(tokens).toBeLessThanOrEqual(text.length);
    }
  });

  it("grows with content and is roughly additive", () => {
    for (const a of samples) {
      for (const b of samples) {
        const joined = count(`${a}\n${b}`);
        expect(joined).toBeGreaterThanOrEqual(Math.max(count(a), count(b)));
        expect(joined).toBeLessThanOrEqual(count(a) + count(b) + 1);
      }
    }
  });

  it("does not carry regex state between calls", () => {
    const text = "alpha beta gamma";
    const first = count(text);
    count("x".repeat(1000));
    expect(count(text)).toBe(first);
  });

  it("handles 1 MB of mixed text quickly", () => {
    const text = samples.join("\n").repeat(Math.ceil(1_000_000 / samples.join("\n").length));
    const started = performance.now();
    const tokens = count(text);
    const elapsed = performance.now() - started;
    expect(tokens).toBeGreaterThan(100_000);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("handles lone surrogates without throwing", () => {
    expect(count("\uD83D")).toBe(1);
  });
});
