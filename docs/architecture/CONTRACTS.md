# AgentContext — Domain Contracts (v0.1)

| Field | Value |
|---|---|
| Status | **FROZEN** — produced by task AC-002 |
| Implemented in | `@agentcontext/shared` (AC-008) as TypeScript types + Zod 4 schemas |
| Change process | Any change requires a separate, explicitly approved task and an update to this file |
| Related | [ARCHITECTURE.md](ARCHITECTURE.md), ADRs [0001](../decisions/0001-package-boundaries.md)–[0008](../decisions/0008-typescript-version.md) |

These contracts revise the roadmap §4 proposals. Every change from the roadmap is
listed in §13.

## Conventions

- **Lines** are 1-based and inclusive. A line ends at `\n`; a preceding `\r` belongs to the line terminator, not the line content.
- **Offsets** are 0-based, end-exclusive **UTF-16 code unit** indices into `NormalizedContext.original` (JavaScript string indices).
- **Hashes** are lowercase hex SHA-256 of the original content encoded as UTF-8.
- **Determinism:** identical input + options + tokenizer produce identical results, **except** `contextId`, timestamps, and `processingTimeMs`.
- Unknown properties in inputs are rejected by schemas (strict objects) unless stated otherwise (`metadata`, `ContentBlock` pass-through fields).

---

## 1. Content

```ts
type ContentType =
  | "json"
  | "text"
  | "logs"
  | "markdown"
  | "code"
  | "mcp_content"
  | "unknown";

/**
 * Minimal, MCP-independent content block. Mirrors the shape of MCP content
 * blocks without importing the SDK. Extra fields are preserved verbatim.
 */
type ContentBlock =
  | { type: "text"; text: string; [k: string]: unknown }
  | { type: "image" | "audio"; data: string; mimeType: string; [k: string]: unknown }
  | { type: "resource" | "resource_link"; [k: string]: unknown };
```

Only `text` blocks are ever optimized. Non-text blocks pass through unchanged
and in their original order.

## 2. Input and options

```ts
interface ContextInput {
  /** Raw text, or an ordered list of content blocks (contentType "mcp_content"). */
  content: string | ContentBlock[];
  /** Optional; detected when omitted. A caller-supplied value always wins. */
  contentType?: ContentType;
  /** Human-readable origin, e.g. "file:src/app.ts", "command:pnpm test", "tool:github.list_issues". */
  source: string;
  /** Optional task description. Informational only in v0.1 (no semantic use). */
  taskContext?: string;
  metadata?: Record<string, unknown>;
}

interface CompressionOptions {
  maxTokens?: number;             // positive integer; budget for returned content
  targetReduction?: number;       // 0..1, desired fraction removed
  preserveStructure?: boolean;    // default true
  preserveErrors?: boolean;       // default true
  allowLossy?: boolean;           // default false; must be true for non-recoverable omissions
  strategy?: string;              // force a strategy by name; still must support() the input
  minBenefitTokens?: number;      // skip if estimated saving is below this
  selection?: SelectionOptions;   // explicit, strategy-specific selections
}

interface SelectionOptions {
  json?: {
    include?: string[];           // JSONPath subset (ADR-0005)
    exclude?: string[];
    maxArrayItems?: number;       // keep first N items per array; rest omitted (recorded)
    maxDepth?: number;            // objects deeper than this are omitted (recorded)
  };
  markdown?: {
    sections?: string[];          // heading text or section IDs to keep
  };
  lines?: {
    ranges: LineRange[];          // keep these line ranges
    context?: number;             // extra lines before/after each range, default 0
  };
  logs?: {
    levels?: LogLevel[];          // levels to keep in full; default ["error","fatal","warn"]
    maxGroupExamples?: number;    // examples shown per repeated group, default 1
  };
}

interface LineRange { start: number; end: number }   // 1-based inclusive
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
```

Rule (R5): no strategy omits content without either an explicit `selection`, or
a policy that only collapses **exact** duplicates/repeats with recorded counts.

## 3. Normalized context

```ts
interface NormalizedContext {
  /** Exact original text. For ContentBlock[] input: canonical JSON (sorted keys, no whitespace). */
  original: string;
  originalHash: string;            // SHA-256 hex of `original`
  contentType: ContentType;        // resolved type
  contentTypeSource: "caller" | "detected";
  source: string;
  taskContext?: string;
  metadata?: Record<string, unknown>;

  /** Line index over `original`. lineStarts[i] = offset where line i+1 begins. */
  lines: { count: number; lineStarts: number[] };
  lineEnding: "lf" | "crlf" | "mixed" | "none";

  /** Present when contentType is "json" and the content parses. */
  json?: unknown;

  /** Present when contentType is "mcp_content". Text blocks get their own NormalizedContext. */
  blocks?: NormalizedBlock[];
}

interface NormalizedBlock {
  index: number;                   // position in the original block list
  block: ContentBlock;             // unchanged original block
  text?: NormalizedContext;        // only for type "text"
}
```

## 4. Analysis

```ts
interface ContentAnalysis {
  contentType: ContentType;
  contentTypeSource: "caller" | "detected";
  detectionConfidence: "high" | "medium" | "low";
  sizeBytes: number;
  lineCount: number;
  tokens: TokenCount;
  duplicateBlocks: { hash: string; occurrences: number; firstLine: number }[];
  logLevels?: Partial<Record<LogLevel, number>>;
  errorLines?: number[];
  headings?: { level: number; text: string; line: number; id: string }[];
  json?: { maxDepth: number; arrayCount: number; largestArrayLength: number };
}

/** Returned by CompressionStrategy.analyze(). */
interface StrategyAnalysis {
  applicable: boolean;
  estimatedOutputTokens: number;
  estimatedSavedTokens: number;
  confidence: "high" | "medium" | "low";
  reason?: string;                 // why not applicable / why low benefit
}
```

## 5. Strategy contract

```ts
interface CompressionStrategy {
  readonly name: string;           // e.g. "json-pruner", "log-compressor"
  readonly version: string;        // bumped on any output-affecting change
  supports(input: NormalizedContext, analysis: ContentAnalysis): boolean;
  analyze(
    input: NormalizedContext,
    analysis: ContentAnalysis,
    options: CompressionOptions,
  ): Promise<StrategyAnalysis>;
  compress(
    input: NormalizedContext,
    analysis: ContentAnalysis,
    options: CompressionOptions,
  ): Promise<StrategyOutput>;
  /** Strategy-specific invariants; called by the validator after compress(). */
  validate?(input: NormalizedContext, output: StrategyOutput): ValidationIssue[];
}

interface StrategyOutput {
  content: string;                 // compact representation returned to the agent
  omittedSegments: OmittedSegment[];
  warnings: Warning[];
  /** Strategy-specific structured summary (e.g. log groups, JSON stats). JSON-serializable. */
  details?: Record<string, unknown>;
}
```

Strategies are pure (ADR-0001): no I/O, clock, or randomness.

## 6. Omissions

```ts
interface OmittedSegment {
  id: string;                      // "s1", "s2", … unique within a variant; stable/deterministic
  type: SegmentType;
  location: SegmentLocation;
  reason: OmissionReason;
  recoverable: boolean;
  occurrences?: number;            // for repeated/duplicate segments
  note?: string;                   // short, content-free description (e.g. "37 repeated lines")
}

type SegmentType =
  | "json_value" | "array_items" | "log_lines" | "log_group"
  | "duplicate_block" | "section" | "paragraph" | "line_range" | "diff_hunk";

/**
 * Canonical location string:
 *   "lines:<start>-<end>"          1-based inclusive
 *   "json:<normalized JSONPath>"   RFC 9535 normalized path, e.g. json:$['items'][3]
 *   "offset:<start>-<end>"         UTF-16 offsets, end-exclusive
 *   "block:<index>/<location>"     inside an mcp_content text block
 * Multiple locations (duplicates) are joined with ";".
 */
type SegmentLocation = string;

type OmissionReason =
  | "excluded_by_selection"
  | "not_selected"
  | "array_limit"
  | "depth_limit"
  | "duplicate"
  | "repeated_log_line"
  | "below_log_level"
  | "budget";
```

## 7. Results

```ts
interface TokenCount {
  count: number;
  tokenizer: TokenizerInfo;
}

interface TokenizerInfo { id: string; version: string; isExact: boolean }

interface CompressionMetrics {
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;             // originalTokens - optimizedTokens (may be 0)
  reductionPercentage: number;     // 0..100, rounded to 1 decimal
  tokenCountIsExact: boolean;      // == tokenizer.isExact
  tokenizer: TokenizerInfo;
  processingTimeMs: number;
}

interface CompressionResult {
  contextId: string | null;        // "ctx_" + 26-char ULID; null when nothing was stored
  content: string | ContentBlock[];// same shape as the input content
  metrics: CompressionMetrics;
  strategy: string;                // strategy name or "passthrough"
  recoveryAvailable: boolean;      // true ONLY after verified persistence
  omittedSegments: OmittedSegment[];
  warnings: Warning[];
}

interface Warning {
  code: WarningCode;
  message: string;                 // never contains raw content
}

type WarningCode =
  | "NO_SUPPORTED_STRATEGY"
  | "BELOW_THRESHOLD"
  | "NO_BENEFIT"
  | "VALIDATION_FAILED"
  | "BUDGET_EXCEEDED"
  | "STORAGE_FAILED"
  | "CONTENT_TYPE_UNCERTAIN"
  | "LOSSY_OMISSION";
```

## 8. Tokenizer

```ts
interface Tokenizer {
  readonly id: string;             // e.g. "fallback-estimator"
  readonly version: string;
  readonly isExact: boolean;
  countTokens(text: string): number | Promise<number>;
}
```

## 9. Retrieval

```ts
interface RetrievalRequest {
  contextId: string;
  selector?:
    | { type: "line_range"; value: string }   // "10-42"; optional context via `contextLines`
    | { type: "json_path"; value: string }    // ADR-0005 subset
    | { type: "keyword"; value: string }      // literal, case-insensitive substring
    | { type: "segment_id"; value: string };  // e.g. "s3"
  contextLines?: number;          // for line_range and keyword; default 0, max 50
  maxTokens?: number;
}

/** Supplied by the server from its configuration/session — never from agent input (ADR-0006). */
interface RetrievalScope {
  workspaceId: string;
  sessionId: string;
  mode: "session" | "workspace";
}

type RetrievalResult =
  | {
      status: "OK";
      contextId: string;
      content: string;
      matches?: { location: SegmentLocation; text: string }[];  // json_path / keyword
      truncated: boolean;          // true if limited by maxTokens/size cap; never silent
      tokens: TokenCount;
    }
  | { status: "NOT_FOUND" | "EXPIRED" | "UNAUTHORIZED" | "TOO_LARGE" | "INTEGRITY_ERROR" | "INVALID_SELECTOR";
      contextId: string;
      message: string; };
```

API shape: `retrieve(request: RetrievalRequest, scope: RetrievalScope): Promise<RetrievalResult>`.

## 10. Storage port

```ts
interface StoragePort {
  /** Persist original atomically and verify its hash. Throws StorageError on failure. */
  putOriginal(record: {
    contextId: string;
    workspaceId: string;
    sessionId: string;
    content: string;
    contentHash: string;
    contentType: ContentType;
    source: string;
    expiresAt: Date;
  }): Promise<void>;

  /** Persist the variant and its omission map in one transaction. */
  putVariant(record: {
    variantId: string;
    contextId: string;
    strategy: string;
    strategyVersion: string;
    optimizedContent: string;
    originalTokens: number;
    optimizedTokens: number;
    tokenizer: TokenizerInfo;
    omittedSegments: OmittedSegment[];
  }): Promise<void>;

  getContext(contextId: string): Promise<StoredContext | null>;
  getOriginal(contextId: string): Promise<string>;       // verifies hash; throws IntegrityError
  getSegments(contextId: string): Promise<OmittedSegment[]>;
  recordEvent(event: OptimizationEvent): Promise<void>;
  cleanup(now: Date): Promise<{ removedContexts: number; freedBytes: number }>;
}

interface StoredContext {
  contextId: string;
  workspaceId: string;
  sessionId: string;
  contentHash: string;
  contentType: ContentType;
  source: string;
  sizeBytes: number;
  createdAt: Date;
  expiresAt: Date;
}
```

## 11. Events and errors

```ts
interface OptimizationEvent {
  contextId: string | null;
  eventType: "optimized" | "skipped" | "fallback" | "retrieved" | "storage_failed";
  strategy: string;
  originalTokens: number;
  optimizedTokens: number;
  recoveredTokens: number;
  tokenizer: TokenizerInfo;
  processingTimeMs: number;
  createdAt: Date;
  // never contains raw content
}

interface EventSink { record(event: OptimizationEvent): void | Promise<void> }

type ErrorCode =
  | "INVALID_INPUT"        // schema violation
  | "INPUT_TOO_LARGE"
  | "UNSUPPORTED_JSONPATH"
  | "STORAGE_ERROR"
  | "INTEGRITY_ERROR"
  | "NOT_FOUND"
  | "EXPIRED"
  | "UNAUTHORIZED"
  | "TOO_LARGE"
  | "PATH_NOT_ALLOWED"     // file adapter
  | "BINARY_FILE"          // file adapter
  | "COMMAND_DISABLED"     // command adapter
  | "COMMAND_NOT_ALLOWED"
  | "COMMAND_TIMEOUT"
  | "INTERNAL";

class AgentContextError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;   // never raw content
}

interface ValidationIssue { code: string; message: string; location?: SegmentLocation }
```

## 12. Core API

```ts
interface AgentContextEngine {
  optimize(input: ContextInput, options?: CompressionOptions, scope?: RetrievalScope): Promise<CompressionResult>;
  retrieve(request: RetrievalRequest, scope: RetrievalScope): Promise<RetrievalResult>;
  stats(filter?: { since?: Date; sessionId?: string }): Promise<OptimizationStats>;
}

interface OptimizationStats {
  optimizations: number;
  skipped: number;
  fallbacks: number;
  retrievals: number;
  originalTokens: number;
  optimizedTokens: number;
  recoveredTokens: number;
  netSavedTokens: number;          // original - (optimized + recovered)
  tokenizer: TokenizerInfo;        // stats are only aggregated per tokenizer
}

function createEngine(deps: {
  tokenizer: Tokenizer;
  strategies: CompressionStrategy[];
  storage?: StoragePort;           // absent → recoveryAvailable is always false
  events?: EventSink;
  config?: EngineConfig;           // thresholds, tolerance, failure policy (shape fixed in AC-014)
}): AgentContextEngine;
```

## 13. Changes from roadmap §4

| # | Change | Reason |
|---|---|---|
| 1 | `ContextInput.contentType` optional; `content` may be `ContentBlock[]` | Auto-detection; preserve MCP block types/order without MCP imports |
| 2 | Added `selection` to `CompressionOptions` | Strategies need explicit selections to satisfy R5 |
| 3 | Defined `NormalizedContext`, `ContentAnalysis`, `StrategyAnalysis`, `StrategyOutput` | Missing from roadmap |
| 4 | Strategy methods receive `analysis`; added `version` and optional `validate()` | Avoid re-analysis; strategy invariants; reproducibility |
| 5 | `metrics.tokenizer` and `processingTimeMs` added | ADR-0003 labelling; latency metric |
| 6 | `warnings` are structured `{code, message}` and always present | Machine-readable; consistent shape |
| 7 | `contextId` nullable | Nothing stored (passthrough without storage) |
| 8 | Canonical `SegmentLocation` format; typed `SegmentType`/`OmissionReason`; `occurrences` | Retrieval must resolve locations exactly |
| 9 | Retrieval takes a separate `RetrievalScope`; typed `RetrievalResult` incl. `INTEGRITY_ERROR`, `INVALID_SELECTOR` | ADR-0006; explicit outcomes |
| 10 | `StoragePort`, `EventSink`, error codes, engine API added | Core depends on interfaces (ADR-0001) |
