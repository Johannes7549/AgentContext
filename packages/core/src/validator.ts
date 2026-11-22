import {
  type CompressionOptions,
  type CompressionStrategy,
  jsonPathResolves,
  type NormalizedContext,
  OmittedSegmentSchema,
  type ParsedLocation,
  parseLocations,
  type StrategyOutput,
  type ValidationIssue,
  WarningSchema,
} from "@agentcontext/shared";

/** Returns true when `path` (a normalized JSONPath) resolves to a value in `json`. */
export type JsonPathResolver = (json: unknown, path: string) => boolean;

export interface ValidatorConfig {
  /** Allowed growth of optimized vs. original tokens, as a fraction (0 = no growth). */
  sizeTolerance: number;
  /** Resolves `json:` locations. Defaults to the shared JSONPath resolver (ADR-0005). */
  resolveJsonPath?: JsonPathResolver;
}

export interface ValidationInput {
  context: NormalizedContext;
  output: StrategyOutput;
  strategy: CompressionStrategy;
  options: CompressionOptions;
  originalTokens: number;
  optimizedTokens: number;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

const MAX_ISSUES = 50;

/**
 * Generic safety checks for a strategy output (ARCHITECTURE.md §6), followed by
 * the strategy's own `validate()`. Any issue makes the output invalid; the
 * pipeline must then return the original content.
 *
 * Generic checks:
 * - every omitted segment matches the schema and has a unique id;
 * - every location parses and resolves against the original (lines, offsets,
 *   JSON paths, text blocks); `mcp_content` requires `block:` locations;
 * - non-recoverable omissions require `allowLossy`;
 * - a smaller output must account for the reduction with omitted segments;
 * - output tokens must not exceed original tokens × (1 + sizeTolerance);
 * - warnings match the schema.
 */
export function validateOutput(input: ValidationInput, config: ValidatorConfig): ValidationReport {
  const { context, output, strategy, options } = input;
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  if (typeof output.content !== "string") {
    add({ code: "INVALID_CONTENT", message: "Strategy output content must be a string" });
  }

  const ids = new Set<string>();
  for (const [i, segment] of output.omittedSegments.entries()) {
    const parsed = OmittedSegmentSchema.safeParse(segment);
    if (!parsed.success) {
      add({ code: "INVALID_SEGMENT", message: `Omitted segment #${i} does not match the schema` });
      continue;
    }
    if (ids.has(segment.id)) {
      add({ code: "DUPLICATE_SEGMENT_ID", message: `Duplicate segment id ${segment.id}` });
    }
    ids.add(segment.id);

    const problem = checkLocation(
      context,
      segment.location,
      config.resolveJsonPath ?? jsonPathResolves,
    );
    if (problem) {
      add({
        code: "UNRESOLVED_LOCATION",
        message: `Segment ${segment.id}: ${problem}`,
        location: segment.location,
      });
    }
    if (!segment.recoverable && options.allowLossy !== true) {
      add({
        code: "LOSSY_NOT_ALLOWED",
        message: `Segment ${segment.id} is not recoverable and allowLossy is not set`,
        location: segment.location,
      });
    }
  }

  for (const [i, warning] of output.warnings.entries()) {
    if (!WarningSchema.safeParse(warning).success) {
      add({ code: "INVALID_WARNING", message: `Warning #${i} does not match the schema` });
    }
  }

  if (input.optimizedTokens < input.originalTokens && output.omittedSegments.length === 0) {
    add({
      code: "UNACCOUNTED_REDUCTION",
      message: "Output is smaller than the original but records no omitted segments",
    });
  }

  const limit = input.originalTokens * (1 + config.sizeTolerance);
  if (input.optimizedTokens > limit) {
    add({
      code: "OUTPUT_GROWTH",
      message: `Output (${input.optimizedTokens} tokens) exceeds the allowed size (${Math.floor(limit)} tokens)`,
    });
  }

  if (strategy.validate) {
    try {
      for (const issue of strategy.validate(context, output)) add(issue);
    } catch (error) {
      add({
        code: "STRATEGY_VALIDATION_FAILED",
        message: `Strategy validate() threw ${error instanceof Error ? error.name : "an error"}`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

function checkLocation(
  context: NormalizedContext,
  location: string,
  resolveJsonPath: JsonPathResolver,
): string | undefined {
  let parsed: ParsedLocation[];
  try {
    parsed = parseLocations(location);
  } catch (error) {
    return error instanceof Error ? error.message : "malformed location";
  }
  for (const part of parsed) {
    const problem =
      context.contentType === "mcp_content"
        ? checkBlockLocation(context, part, resolveJsonPath)
        : part.kind === "block"
          ? "block locations are only valid for mcp_content"
          : checkPlainLocation(context, part, resolveJsonPath);
    if (problem) return problem;
  }
  return undefined;
}

function checkBlockLocation(
  context: NormalizedContext,
  part: ParsedLocation,
  resolveJsonPath: JsonPathResolver,
): string | undefined {
  if (part.kind !== "block") return "mcp_content locations must use block:<index>/...";
  const block = context.blocks?.[part.index];
  if (!block?.text) return `block ${part.index} is not a text block`;
  return checkPlainLocation(block.text, part.inner, resolveJsonPath);
}

function checkPlainLocation(
  context: NormalizedContext,
  part: ParsedLocation,
  resolveJsonPath: JsonPathResolver,
): string | undefined {
  switch (part.kind) {
    case "lines":
      return part.end <= context.lines.count
        ? undefined
        : `lines ${part.start}-${part.end} exceed line count ${context.lines.count}`;
    case "offset":
      return part.end <= context.original.length
        ? undefined
        : `offsets ${part.start}-${part.end} exceed length ${context.original.length}`;
    case "json":
      if (context.json === undefined) return "json location on content without parsed JSON";
      if (!resolveJsonPath(context.json, part.path)) {
        return "json path does not resolve in the original";
      }
      return undefined;
    case "block":
      return "nested block location";
  }
}
