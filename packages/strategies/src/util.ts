import type {
  CompressionOptions,
  CompressionStrategy,
  ContentAnalysis,
  NormalizedContext,
  StrategyAnalysis,
  StrategyOutput,
  ValidationIssue,
} from "@agentcontext/shared";

/** Result of planning a transformation: an output, or a reason it does not apply. */
export type Plan = { kind: "output"; output: StrategyOutput } | { kind: "skip"; reason: string };

export interface StrategyDefinition {
  name: string;
  version: string;
  supports(context: NormalizedContext, analysis: ContentAnalysis): boolean;
  /** Pure and deterministic. Called by both analyze() and compress(). */
  plan(context: NormalizedContext, analysis: ContentAnalysis, options: CompressionOptions): Plan;
  validate?(context: NormalizedContext, output: StrategyOutput): ValidationIssue[];
  confidence?: StrategyAnalysis["confidence"];
}

/**
 * Build a CompressionStrategy from a pure `plan` function. `analyze` runs the
 * plan and estimates output tokens proportionally to output length, so the
 * estimate uses the same tokenizer basis as the analysis.
 */
export function defineStrategy(definition: StrategyDefinition): CompressionStrategy {
  const strategy: CompressionStrategy = {
    name: definition.name,
    version: definition.version,
    supports: (context, analysis) => definition.supports(context, analysis),
    async analyze(context, analysis, options) {
      const plan = definition.plan(context, analysis, options);
      if (plan.kind === "skip") {
        return {
          applicable: false,
          estimatedOutputTokens: analysis.tokens.count,
          estimatedSavedTokens: 0,
          confidence: "high",
          reason: plan.reason,
        };
      }
      const estimatedOutputTokens = estimateTokens(analysis, context.original, plan.output.content);
      return {
        applicable: plan.output.omittedSegments.length > 0,
        estimatedOutputTokens,
        estimatedSavedTokens: Math.max(0, analysis.tokens.count - estimatedOutputTokens),
        confidence: definition.confidence ?? "high",
      };
    },
    async compress(context, analysis, options) {
      const plan = definition.plan(context, analysis, options);
      if (plan.kind === "skip") {
        return { content: context.original, omittedSegments: [], warnings: [] };
      }
      return plan.output;
    },
  };
  if (definition.validate) strategy.validate = definition.validate;
  return strategy;
}

export function estimateTokens(
  analysis: ContentAnalysis,
  original: string,
  output: string,
): number {
  if (original.length === 0) return 0;
  return Math.ceil((analysis.tokens.count * output.length) / original.length);
}

/** Sequential, deterministic segment ids: s1, s2, ... */
export class SegmentIds {
  #next = 1;
  next(): string {
    return `s${this.#next++}`;
  }
}

/** Uniform omission marker placed in text output. */
export function marker(id: string, description: string): string {
  return `[... ${id}: ${description}]`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Collapse sorted 1-based line numbers into inclusive ranges. */
export function toRanges(lines: readonly number[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const line of lines) {
    const last = ranges.at(-1);
    if (last && line === last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }
  return ranges;
}

export function describeRanges(ranges: readonly { start: number; end: number }[], max = 3): string {
  const shown = ranges
    .slice(0, max)
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`));
  return ranges.length > max
    ? `${shown.join(", ")}, ... (+${ranges.length - max} more)`
    : shown.join(", ");
}
