import {
  AgentContextError,
  buildLineIndex,
  type Confidence,
  type ContentBlock,
  type ContentType,
  type ContextInput,
  ContextInputSchema,
  canonicalJson,
  detectLineEnding,
  type NormalizedBlock,
  type NormalizedContext,
  parseOrThrow,
  sha256Hex,
  utf8ByteLength,
} from "@agentcontext/shared";

/** Content-type detector plugged in by the analyzer (AC-010). Must be deterministic. */
export type ContentTypeDetector = (text: string) => {
  contentType: ContentType;
  confidence: Confidence;
};

export interface NormalizeOptions {
  /** Used when the caller did not specify a content type. Without it, text is "unknown". */
  detectContentType?: ContentTypeDetector;
  /** Reject inputs whose original exceeds this many UTF-8 bytes. */
  maxInputBytes?: number;
}

/**
 * Convert untrusted input into a NormalizedContext (CONTRACTS.md §3).
 *
 * Guarantees:
 * - `original` is the exact input text (or canonical JSON of the block list).
 * - Block types and order are preserved; only text blocks get a nested context.
 * - Nothing is trimmed, re-encoded or line-ending-normalized.
 * - Output is deterministic for identical input and options.
 */
export function normalize(input: unknown, options: NormalizeOptions = {}): NormalizedContext {
  const parsed: ContextInput = parseOrThrow(ContextInputSchema, input, "context input");
  const { content } = parsed;

  if (typeof content === "string") {
    enforceSize(content, options.maxInputBytes);
    return normalizeText(content, parsed, options);
  }

  const original = canonicalJson(content);
  enforceSize(original, options.maxInputBytes);
  const blocks = content.map((block, index) =>
    normalizeBlock(block, index, parsed.source, options),
  );
  return {
    ...base(original, parsed),
    contentType: "mcp_content",
    contentTypeSource: parsed.contentType === undefined ? "detected" : "caller",
    blocks,
  };
}

function normalizeText(
  text: string,
  parsed: Pick<ContextInput, "contentType" | "source" | "taskContext" | "metadata">,
  options: NormalizeOptions,
): NormalizedContext {
  let contentType: ContentType;
  let contentTypeSource: NormalizedContext["contentTypeSource"];
  if (parsed.contentType !== undefined) {
    contentType = parsed.contentType;
    contentTypeSource = "caller";
  } else {
    contentType = options.detectContentType?.(text).contentType ?? "unknown";
    contentTypeSource = "detected";
  }

  const context: NormalizedContext = { ...base(text, parsed), contentType, contentTypeSource };
  if (contentType === "json") {
    const value = tryParseJson(text);
    if (value.ok) context.json = value.value;
  }
  return context;
}

function normalizeBlock(
  block: ContentBlock,
  index: number,
  source: string,
  options: NormalizeOptions,
): NormalizedBlock {
  if (block.type !== "text") return { index, block };
  const text = normalizeText(block.text, { source: `${source}#block[${index}]` }, options);
  return { index, block, text };
}

function base(
  original: string,
  parsed: Pick<ContextInput, "source" | "taskContext" | "metadata">,
): Omit<NormalizedContext, "contentType" | "contentTypeSource"> {
  return {
    original,
    originalHash: sha256Hex(original),
    source: parsed.source,
    ...(parsed.taskContext !== undefined ? { taskContext: parsed.taskContext } : {}),
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
    lines: buildLineIndex(original),
    lineEnding: detectLineEnding(original),
  };
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    // A UTF-8 BOM is not valid JSON but is common in files; it stays in `original`.
    return { ok: true, value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) };
  } catch {
    return { ok: false };
  }
}

function enforceSize(original: string, maxInputBytes: number | undefined): void {
  if (maxInputBytes === undefined) return;
  const size = utf8ByteLength(original);
  if (size > maxInputBytes) {
    throw new AgentContextError("INPUT_TOO_LARGE", "Input exceeds the configured size limit", {
      sizeBytes: size,
      maxInputBytes,
    });
  }
}
