import {
  AgentContextError,
  buildLineIndex,
  isAgentContextError,
  joinLocations,
  jsonLocation,
  type LineIndex,
  lineRangeSpan,
  linesLocation,
  offsetLocation,
  type ParsedLocation,
  parseLocations,
  parseOrThrow,
  queryJsonPath,
  type RetrievalRequest,
  RetrievalRequestSchema,
  type RetrievalResult,
  type RetrievalScope,
  RetrievalScopeSchema,
  resolveNormalizedPath,
  type StoragePort,
  type StoredContext,
  sha256Hex,
  type Tokenizer,
  utf8ByteLength,
} from "@agentcontext/shared";

export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_KEYWORD_MATCHES = 50;

export interface RetrievalOptions {
  tokenizer: Tokenizer;
  now?: () => Date;
  /** Hard cap on the size of returned content (UTF-8 bytes). */
  maxResponseBytes?: number;
  /** Maximum keyword matches returned before marking the result truncated. */
  maxKeywordMatches?: number;
}

type Match = { location: string; text: string };
type Failure = Extract<RetrievalResult, { message: string }>;
type Selected = { content: string; matches?: Match[]; partial?: boolean } | Failure;

/**
 * Recover original content (CONTRACTS.md §9, ADR-0006).
 *
 * Checks, in order: request/scope validation (INVALID_INPUT is thrown),
 * existence (NOT_FOUND), scope — same workspace, and same session unless mode
 * is "workspace" (UNAUTHORIZED), expiry (EXPIRED), hash integrity
 * (INTEGRITY_ERROR). Then applies the selector and size limits:
 *
 * - none: the full original;
 * - line_range "a-b" (+ contextLines): exact original bytes of those lines;
 * - json_path: matching values (restricted JSONPath, ADR-0005);
 * - keyword: case-insensitive literal matches with line and offset locations;
 *   extra matches beyond the limits are dropped and `truncated` is set;
 * - segment_id: the exact content of a recorded omitted segment.
 *
 * Other results above `maxTokens` or `maxResponseBytes` return TOO_LARGE;
 * content is never truncated silently.
 */
export async function retrieveContext(
  storage: StoragePort,
  rawRequest: unknown,
  rawScope: unknown,
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const request = parseOrThrow(RetrievalRequestSchema, rawRequest, "retrieval request");
  const scope = parseOrThrow(RetrievalScopeSchema, rawScope, "scope");
  const { contextId } = request;
  const now = (options.now ?? (() => new Date()))();
  const fail = (status: Failure["status"], message: string): Failure => ({
    status,
    contextId,
    message,
  });

  const stored = await storage.getContext(contextId);
  if (!stored) return fail("NOT_FOUND", "Context not found");
  if (!inScope(stored, scope)) return fail("UNAUTHORIZED", "Context is outside the current scope");
  if (stored.expiresAt.getTime() <= now.getTime()) return fail("EXPIRED", "Context has expired");

  let original: string;
  try {
    original = await storage.getOriginal(contextId);
  } catch (error) {
    if (isAgentContextError(error, "NOT_FOUND")) return fail("NOT_FOUND", "Context not found");
    return fail("INTEGRITY_ERROR", "Stored content could not be verified");
  }
  // Defence in depth: do not rely on the storage port alone to verify the hash.
  if (sha256Hex(original) !== stored.contentHash) {
    return fail("INTEGRITY_ERROR", "Stored content could not be verified");
  }

  const selected = await select(storage, stored, original, request, options, fail);
  if ("status" in selected) return selected;

  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let { content, matches } = selected;
  let truncated = selected.partial ?? false;
  let tokens = await count(options.tokenizer, content);
  const tooBig = () =>
    utf8ByteLength(content) > maxBytes ||
    (request.maxTokens !== undefined && tokens > request.maxTokens);

  if (tooBig() && request.selector?.type === "keyword" && matches) {
    while (matches.length > 0 && tooBig()) {
      matches = matches.slice(0, -1);
      content = formatKeywordMatches(matches);
      tokens = await count(options.tokenizer, content);
      truncated = true;
    }
  }
  if (tooBig()) {
    const limit =
      request.maxTokens !== undefined && tokens > request.maxTokens
        ? `${tokens} tokens exceeds maxTokens ${request.maxTokens}`
        : `${utf8ByteLength(content)} bytes exceeds the response limit of ${maxBytes} bytes`;
    return fail("TOO_LARGE", `Result is too large (${limit}); use a narrower selector`);
  }

  return {
    status: "OK",
    contextId,
    content,
    ...(matches ? { matches } : {}),
    truncated,
    tokens: {
      count: tokens,
      tokenizer: {
        id: options.tokenizer.id,
        version: options.tokenizer.version,
        isExact: options.tokenizer.isExact,
      },
    },
  };
}

async function select(
  storage: StoragePort,
  stored: StoredContext,
  original: string,
  request: RetrievalRequest,
  options: RetrievalOptions,
  fail: (status: Failure["status"], message: string) => Failure,
): Promise<Selected> {
  const selector = request.selector;
  if (!selector) return { content: original };
  const isBlocks = stored.contentType === "mcp_content";

  switch (selector.type) {
    case "line_range": {
      if (isBlocks)
        return fail("INVALID_SELECTOR", "Use segment_id to retrieve parts of MCP content");
      const [start, end] = selector.value.split("-").map(Number) as [number, number];
      if (end < start) return fail("INVALID_SELECTOR", "Line range end is before its start");
      const index = buildLineIndex(original);
      if (start > index.count) {
        return fail("INVALID_SELECTOR", `Line ${start} is beyond the last line (${index.count})`);
      }
      const extra = request.contextLines ?? 0;
      const from = Math.max(1, start - extra);
      const to = Math.min(index.count, end + extra);
      const span = lineRangeSpan(original, index, from, to);
      const text = original.slice(span.start, span.end);
      return { content: text, matches: [{ location: linesLocation(from, to), text }] };
    }

    case "json_path": {
      if (stored.contentType !== "json") {
        return fail("INVALID_SELECTOR", "json_path requires JSON content");
      }
      const json = parseJson(original);
      if (json === undefined) return fail("INVALID_SELECTOR", "Stored content is not valid JSON");
      try {
        const results = queryJsonPath(json.value, selector.value);
        const matches = results.map((r) => ({
          location: jsonLocation(r.path),
          text: JSON.stringify(r.value),
        }));
        const content =
          results.length === 1
            ? JSON.stringify(results[0]?.value, null, 2)
            : JSON.stringify(
                results.map((r) => ({ path: r.path, value: r.value })),
                null,
                2,
              );
        return { content: results.length === 0 ? "" : content, matches };
      } catch (error) {
        if (isAgentContextError(error, "TOO_LARGE")) return fail("TOO_LARGE", error.message);
        if (isAgentContextError(error)) return fail("INVALID_SELECTOR", error.message);
        throw error;
      }
    }

    case "keyword": {
      if (isBlocks)
        return fail("INVALID_SELECTOR", "Use segment_id to retrieve parts of MCP content");
      const limit = options.maxKeywordMatches ?? DEFAULT_MAX_KEYWORD_MATCHES;
      const index = buildLineIndex(original);
      const pattern = new RegExp(escapeRegExp(selector.value), "iu");
      const extra = request.contextLines ?? 0;
      const matches: Match[] = [];
      let partial = false;
      for (let n = 1; n <= index.count; n++) {
        const span = lineRangeSpan(original, index, n, n);
        const line = original.slice(span.start, span.end);
        const hit = pattern.exec(line);
        if (!hit) continue;
        if (matches.length >= limit) {
          partial = true;
          break;
        }
        const from = Math.max(1, n - extra);
        const to = Math.min(index.count, n + extra);
        const block = lineRangeSpan(original, index, from, to);
        const start = span.start + hit.index;
        matches.push({
          location: joinLocations([
            linesLocation(from, to),
            offsetLocation(start, start + hit[0].length),
          ]),
          text: stripTrailingNewline(original.slice(block.start, block.end)),
        });
      }
      return { content: formatKeywordMatches(matches), matches, partial };
    }

    case "segment_id": {
      const segment = (await storage.getSegments(stored.contextId)).find(
        (s) => s.id === selector.value,
      );
      if (!segment) return fail("INVALID_SELECTOR", `Unknown segment ${selector.value}`);
      let parts: ParsedLocation[];
      try {
        parts = parseLocations(segment.location);
      } catch {
        return fail("INVALID_SELECTOR", `Segment ${segment.id} has an invalid location`);
      }
      const matches: Match[] = [];
      for (const part of parts) {
        const text = resolveLocation(original, isBlocks, part);
        if (text === undefined) {
          return fail(
            "INTEGRITY_ERROR",
            `Segment ${segment.id} does not resolve in the stored original`,
          );
        }
        matches.push({ location: locationString(part), text });
      }
      return { content: matches.map((m) => m.text).join("\n"), matches };
    }
  }
}

function resolveLocation(
  original: string,
  isBlocks: boolean,
  part: ParsedLocation,
): string | undefined {
  if (part.kind === "block") {
    if (!isBlocks) return undefined;
    const blocks = parseJson(original)?.value;
    const block = Array.isArray(blocks)
      ? (blocks[part.index] as { type?: unknown; text?: unknown })
      : undefined;
    if (block?.type !== "text" || typeof block.text !== "string") return undefined;
    return resolveLocation(block.text, false, part.inner);
  }
  if (isBlocks) return undefined;
  switch (part.kind) {
    case "lines": {
      const index: LineIndex = buildLineIndex(original);
      if (part.end > index.count) return undefined;
      const span = lineRangeSpan(original, index, part.start, part.end);
      return original.slice(span.start, span.end);
    }
    case "offset":
      return part.end <= original.length ? original.slice(part.start, part.end) : undefined;
    case "json": {
      const json = parseJson(original);
      if (!json) return undefined;
      const resolved = resolveNormalizedPath(json.value, part.path);
      return resolved.found ? JSON.stringify(resolved.value, null, 2) : undefined;
    }
  }
}

function locationString(part: ParsedLocation): string {
  switch (part.kind) {
    case "lines":
      return linesLocation(part.start, part.end);
    case "offset":
      return offsetLocation(part.start, part.end);
    case "json":
      return jsonLocation(part.path);
    case "block":
      return `block:${part.index}/${locationString(part.inner)}`;
  }
}

function inScope(stored: StoredContext, scope: RetrievalScope): boolean {
  if (stored.workspaceId !== scope.workspaceId) return false;
  return scope.mode === "workspace" || stored.sessionId === scope.sessionId;
}

function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) };
  } catch {
    return undefined;
  }
}

function formatKeywordMatches(matches: readonly Match[]): string {
  return matches
    .map((m) => {
      const lines = parseLocations(m.location)[0] as Extract<ParsedLocation, { kind: "lines" }>;
      const label =
        lines.start === lines.end ? `line ${lines.start}` : `lines ${lines.start}-${lines.end}`;
      return `--- ${label} ---\n${m.text}`;
    })
    .join("\n");
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function count(tokenizer: Tokenizer, text: string): Promise<number> {
  const n = await tokenizer.countTokens(text);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new AgentContextError("INTERNAL", "Tokenizer returned an invalid count", {
      tokenizer: tokenizer.id,
    });
  }
  return n;
}
