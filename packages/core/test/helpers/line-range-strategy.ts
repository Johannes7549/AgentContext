import {
  type CompressionStrategy,
  lineRangeSpan,
  linesLocation,
  type OmittedSegment,
} from "@agentcontext/shared";

/**
 * Minimal real strategy for pipeline tests: keeps the first `keep` lines and
 * records the rest as one recoverable omitted segment.
 */
export function keepFirstLines(keep = 3, name = "keep-first-lines"): CompressionStrategy {
  return {
    name,
    version: "1.0.0",
    supports: (context) => context.lines.count > keep,
    async analyze(context, analysis) {
      const ratio = keep / context.lines.count;
      const estimatedOutputTokens = Math.ceil(analysis.tokens.count * ratio) + 10;
      return {
        applicable: true,
        estimatedOutputTokens,
        estimatedSavedTokens: Math.max(0, analysis.tokens.count - estimatedOutputTokens),
        confidence: "high",
      };
    },
    async compress(context) {
      const kept = lineRangeSpan(context.original, context.lines, 1, keep);
      const segment: OmittedSegment = {
        id: "s1",
        type: "line_range",
        location: linesLocation(keep + 1, context.lines.count),
        reason: "not_selected",
        recoverable: true,
      };
      return {
        content: `${context.original.slice(kept.start, kept.end)}[lines ${keep + 1}-${context.lines.count} omitted: s1]\n`,
        omittedSegments: [segment],
        warnings: [],
      };
    },
  };
}
