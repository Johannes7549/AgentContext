import {
  buildLineIndex,
  type CompressionOptions,
  type CompressionStrategy,
  type ContentAnalysis,
  type ContentType,
  detectLineEnding,
  lineText,
  type NormalizedContext,
  parseLocations,
  queryJsonPath,
  type StrategyOutput,
  sha256Hex,
} from "@agentcontext/shared";

/** Build a NormalizedContext without depending on @agentcontext/core. */
export function makeContext(content: string, contentType: ContentType): NormalizedContext {
  const context: NormalizedContext = {
    original: content,
    originalHash: sha256Hex(content),
    contentType,
    contentTypeSource: "caller",
    source: "test",
    lines: buildLineIndex(content),
    lineEnding: detectLineEnding(content),
  };
  if (contentType === "json") {
    try {
      context.json = JSON.parse(content);
    } catch {
      // leave undefined, as the normalizer does
    }
  }
  return context;
}

/** Minimal analysis: ~4 characters per token. */
export function makeAnalysis(context: NormalizedContext): ContentAnalysis {
  return {
    contentType: context.contentType,
    contentTypeSource: "caller",
    detectionConfidence: "high",
    sizeBytes: Buffer.byteLength(context.original),
    lineCount: context.lines.count,
    tokens: {
      count: Math.ceil(context.original.length / 4),
      tokenizer: { id: "test", version: "1", isExact: false },
    },
    duplicateBlocks: [],
  };
}

export async function run(
  strategy: CompressionStrategy,
  content: string,
  contentType: ContentType,
  options: CompressionOptions = {},
) {
  const context = makeContext(content, contentType);
  const analysis = makeAnalysis(context);
  const supported = strategy.supports(context, analysis);
  const estimate = await strategy.analyze(context, analysis, options);
  const output = await strategy.compress(context, analysis, options);
  const issues = strategy.validate?.(context, output) ?? [];
  return { context, analysis, supported, estimate, output, issues };
}

/** Text of the original covered by a (single or joined) location. */
export function recover(context: NormalizedContext, location: string): string[] {
  return parseLocations(location).map((part) => {
    if (part.kind === "lines") {
      const lines: string[] = [];
      for (let n = part.start; n <= part.end; n++)
        lines.push(lineText(context.original, context.lines, n));
      return lines.join("\n");
    }
    if (part.kind === "json") {
      return JSON.stringify(queryJsonPath(context.json, part.path)[0]?.value);
    }
    if (part.kind === "offset") return context.original.slice(part.start, part.end);
    throw new Error("unsupported location in test");
  });
}

export function ids(output: StrategyOutput): string[] {
  return output.omittedSegments.map((s) => s.id);
}
