import type {
  CompressionOptions,
  CompressionStrategy,
  ContentAnalysis,
  ContentType,
  NormalizedContext,
  StrategyAnalysis,
  StrategyOutput,
  ValidationIssue,
} from "@agentcontext/shared";

export interface FakeStrategyOptions {
  name: string;
  types?: ContentType[];
  saved?: number;
  confidence?: StrategyAnalysis["confidence"];
  applicable?: boolean;
  analyzeThrows?: boolean;
  supportsThrows?: boolean;
  compress?: (context: NormalizedContext, options: CompressionOptions) => StrategyOutput;
  validate?: (context: NormalizedContext, output: StrategyOutput) => ValidationIssue[];
}

/** Configurable strategy for selector/validator/pipeline tests. */
export function fakeStrategy(opts: FakeStrategyOptions): CompressionStrategy & { calls: string[] } {
  const calls: string[] = [];
  const strategy: CompressionStrategy & { calls: string[] } = {
    name: opts.name,
    version: "0.0.1",
    calls,
    supports(context: NormalizedContext, _analysis: ContentAnalysis) {
      calls.push("supports");
      if (opts.supportsThrows) throw new Error("supports failed");
      return !opts.types || opts.types.includes(context.contentType);
    },
    async analyze(_context, analysis) {
      calls.push("analyze");
      if (opts.analyzeThrows) throw new TypeError("analyze failed");
      const saved = opts.saved ?? 100;
      return {
        applicable: opts.applicable ?? true,
        estimatedSavedTokens: saved,
        estimatedOutputTokens: Math.max(0, analysis.tokens.count - saved),
        confidence: opts.confidence ?? "high",
      };
    },
    async compress(context, _analysis, options) {
      calls.push("compress");
      if (opts.compress) return opts.compress(context, options);
      return { content: context.original, omittedSegments: [], warnings: [] };
    },
  };
  if (opts.validate) strategy.validate = opts.validate;
  return strategy;
}
