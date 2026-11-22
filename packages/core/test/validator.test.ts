import type { CompressionOptions, OmittedSegment, StrategyOutput } from "@agentcontext/shared";
import { describe, expect, it } from "vitest";
import { normalize, type ValidatorConfig, validateOutput } from "../src/index.js";
import { fakeStrategy } from "./helpers/fake-strategy.js";

const text = "line 1\nline 2\nline 3\nline 4\n";
const logs = normalize({ content: text, contentType: "logs", source: "s" });
const json = normalize({ content: '{"a":[1,2],"b":{"c":true}}', contentType: "json", source: "s" });
const blocks = normalize({
  content: [
    { type: "text", text },
    { type: "image", data: "AA==", mimeType: "image/png" },
  ],
  source: "s",
});

const segment = (overrides: Partial<OmittedSegment> = {}): OmittedSegment => ({
  id: "s1",
  type: "line_range",
  location: "lines:2-3",
  reason: "not_selected",
  recoverable: true,
  ...overrides,
});

const output = (overrides: Partial<StrategyOutput> = {}): StrategyOutput => ({
  content: "line 1\n[2 lines omitted: s1]\nline 4\n",
  omittedSegments: [segment()],
  warnings: [],
  ...overrides,
});

const config: ValidatorConfig = { sizeTolerance: 0 };

function run(
  out: StrategyOutput,
  {
    context = logs,
    options = {},
    originalTokens = 20,
    optimizedTokens = 10,
    strategy = fakeStrategy({ name: "s" }),
    cfg = config,
  }: {
    context?: typeof logs;
    options?: CompressionOptions;
    originalTokens?: number;
    optimizedTokens?: number;
    strategy?: ReturnType<typeof fakeStrategy>;
    cfg?: ValidatorConfig;
  } = {},
) {
  return validateOutput(
    { context, output: out, strategy, options, originalTokens, optimizedTokens },
    cfg,
  );
}

const codes = (report: ReturnType<typeof run>) => report.issues.map((i) => i.code);

describe("validateOutput", () => {
  it("accepts a well-formed output", () => {
    expect(run(output())).toEqual({ valid: true, issues: [] });
  });

  it("rejects segments that do not match the schema", () => {
    const bad = { ...segment(), reason: "irrelevant" } as unknown as OmittedSegment;
    expect(codes(run(output({ omittedSegments: [bad] })))).toEqual(["INVALID_SEGMENT"]);
  });

  it("rejects duplicate segment ids", () => {
    const report = run(
      output({ omittedSegments: [segment(), segment({ location: "lines:4-4" })] }),
    );
    expect(codes(report)).toEqual(["DUPLICATE_SEGMENT_ID"]);
  });

  it.each([
    ["lines beyond the end", "lines:3-9"],
    ["offsets beyond the end", "offset:0-999"],
    ["malformed location", "lines:x"],
    ["json on non-json content", "json:$['a']"],
    ["block on plain content", "block:0/lines:1-1"],
  ])("rejects %s", (_name, location) => {
    expect(codes(run(output({ omittedSegments: [segment({ location })] })))).toEqual([
      "UNRESOLVED_LOCATION",
    ]);
  });

  it("validates every part of a joined location", () => {
    const report = run(output({ omittedSegments: [segment({ location: "lines:1-1;lines:7-7" })] }));
    expect(codes(report)).toEqual(["UNRESOLVED_LOCATION"]);
  });

  it("uses the JSON path resolver when provided", () => {
    const resolver = (_json: unknown, path: string) => path === "$['a']";
    const ok = run(
      output({ omittedSegments: [segment({ type: "json_value", location: "json:$['a']" })] }),
      {
        context: json,
        cfg: { sizeTolerance: 0, resolveJsonPath: resolver },
      },
    );
    const missing = run(
      output({ omittedSegments: [segment({ type: "json_value", location: "json:$['zzz']" })] }),
      { context: json, cfg: { sizeTolerance: 0, resolveJsonPath: resolver } },
    );
    expect(ok.valid).toBe(true);
    expect(codes(missing)).toEqual(["UNRESOLVED_LOCATION"]);
  });

  it("requires block locations for mcp_content and checks the text block", () => {
    const valid = run(output({ omittedSegments: [segment({ location: "block:0/lines:2-3" })] }), {
      context: blocks,
    });
    expect(valid.valid).toBe(true);
    for (const location of [
      "lines:1-1",
      "block:1/lines:1-1",
      "block:5/lines:1-1",
      "block:0/lines:1-9",
    ]) {
      const report = run(output({ omittedSegments: [segment({ location })] }), { context: blocks });
      expect(codes(report)).toEqual(["UNRESOLVED_LOCATION"]);
    }
  });

  it("requires allowLossy for non-recoverable omissions", () => {
    const lossy = output({ omittedSegments: [segment({ recoverable: false })] });
    expect(codes(run(lossy))).toEqual(["LOSSY_NOT_ALLOWED"]);
    expect(run(lossy, { options: { allowLossy: true } }).valid).toBe(true);
  });

  it("rejects an unexplained reduction", () => {
    expect(codes(run(output({ omittedSegments: [] })))).toEqual(["UNACCOUNTED_REDUCTION"]);
    expect(run(output({ omittedSegments: [] }), { optimizedTokens: 20 }).valid).toBe(true);
  });

  it("rejects growth beyond the tolerance", () => {
    expect(codes(run(output(), { optimizedTokens: 21 }))).toEqual(["OUTPUT_GROWTH"]);
    expect(run(output(), { optimizedTokens: 22, cfg: { sizeTolerance: 0.1 } }).valid).toBe(true);
  });

  it("rejects malformed warnings and non-string content", () => {
    const bad = output({
      content: 42 as unknown as string,
      warnings: [{ code: "MADE_UP", message: "x" } as never],
    });
    expect(codes(run(bad))).toEqual(["INVALID_CONTENT", "INVALID_WARNING"]);
  });

  it("appends strategy-specific issues", () => {
    const strategy = fakeStrategy({
      name: "s",
      validate: () => [{ code: "LOG_ERROR_DROPPED", message: "error event missing" }],
    });
    expect(codes(run(output(), { strategy }))).toEqual(["LOG_ERROR_DROPPED"]);
  });

  it("reports a throwing strategy validator as an issue", () => {
    const strategy = fakeStrategy({
      name: "s",
      validate: () => {
        throw new RangeError("bug");
      },
    });
    expect(run(output(), { strategy }).issues).toEqual([
      { code: "STRATEGY_VALIDATION_FAILED", message: "Strategy validate() threw RangeError" },
    ]);
  });

  it("caps the number of reported issues", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      segment({ id: `s${i + 1}`, location: "lines:99-99" }),
    );
    expect(run(output({ omittedSegments: many })).issues).toHaveLength(50);
  });
});

describe("validateOutput — default JSON path resolver", () => {
  it("resolves json locations against the parsed original", () => {
    const ok = run(
      output({ omittedSegments: [segment({ type: "json_value", location: "json:$['b']['c']" })] }),
      { context: json },
    );
    const missing = run(
      output({ omittedSegments: [segment({ type: "json_value", location: "json:$['a'][5]" })] }),
      { context: json },
    );
    expect(ok.valid).toBe(true);
    expect(codes(missing)).toEqual(["UNRESOLVED_LOCATION"]);
  });
});
