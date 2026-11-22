/**
 * Behavioural contracts and internal data shapes (CONTRACTS.md §3–§5, §8, §10–§12).
 * These are not validated at runtime; they never cross a trust boundary directly.
 */
import type { ContentBlock, ContentType } from "./content.js";
import type { CompressionOptions, ContextInput, LogLevel } from "./input.js";
import type { CompressionResult, TokenCount, TokenizerInfo, Warning } from "./results.js";
import type { RetrievalRequest, RetrievalResult, RetrievalScope } from "./retrieval.js";
import type { OmittedSegment, SegmentLocation } from "./segments.js";

// --- Normalized context (§3) ------------------------------------------------

export interface LineIndex {
  /** Number of lines. "" has 0 lines; a trailing line terminator does not start a new line. */
  count: number;
  /** lineStarts[i] = UTF-16 offset in `original` where line i+1 begins. */
  lineStarts: number[];
}

export type LineEnding = "lf" | "crlf" | "mixed" | "none";

export interface NormalizedContext {
  /** Exact original text. For ContentBlock[] input: canonical JSON (sorted keys, no whitespace). */
  original: string;
  /** SHA-256 hex of `original` encoded as UTF-8. */
  originalHash: string;
  contentType: ContentType;
  contentTypeSource: "caller" | "detected";
  source: string;
  taskContext?: string;
  metadata?: Record<string, unknown>;
  lines: LineIndex;
  lineEnding: LineEnding;
  /** Present when contentType is "json" and the content parses. */
  json?: unknown;
  /** Present when contentType is "mcp_content". */
  blocks?: NormalizedBlock[];
}

export interface NormalizedBlock {
  index: number;
  block: ContentBlock;
  /** Only for type "text". */
  text?: NormalizedContext;
}

// --- Analysis (§4) ----------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

export interface ContentAnalysis {
  contentType: ContentType;
  contentTypeSource: "caller" | "detected";
  detectionConfidence: Confidence;
  sizeBytes: number;
  lineCount: number;
  tokens: TokenCount;
  duplicateBlocks: { hash: string; occurrences: number; firstLine: number }[];
  logLevels?: Partial<Record<LogLevel, number>>;
  errorLines?: number[];
  headings?: { level: number; text: string; line: number; id: string }[];
  json?: { maxDepth: number; arrayCount: number; largestArrayLength: number };
}

export interface StrategyAnalysis {
  applicable: boolean;
  estimatedOutputTokens: number;
  estimatedSavedTokens: number;
  confidence: Confidence;
  reason?: string;
}

// --- Strategies (§5) --------------------------------------------------------

export interface ValidationIssue {
  code: string;
  message: string;
  location?: SegmentLocation;
}

export interface StrategyOutput {
  content: string;
  omittedSegments: OmittedSegment[];
  warnings: Warning[];
  details?: Record<string, unknown>;
}

export interface CompressionStrategy {
  readonly name: string;
  readonly version: string;
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
  validate?(input: NormalizedContext, output: StrategyOutput): ValidationIssue[];
}

// --- Tokenizer (§8) ---------------------------------------------------------

export interface Tokenizer {
  readonly id: string;
  readonly version: string;
  readonly isExact: boolean;
  countTokens(text: string): number | Promise<number>;
}

// --- Storage, events (§10, §11) ---------------------------------------------

export interface StoredContext {
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

export interface StoragePort {
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
  getOriginal(contextId: string): Promise<string>;
  getSegments(contextId: string): Promise<OmittedSegment[]>;
  recordEvent(event: OptimizationEvent): Promise<void>;
  cleanup(now: Date): Promise<{ removedContexts: number; freedBytes: number }>;
}

/** Never contains raw content. */
export interface OptimizationEvent {
  contextId: string | null;
  eventType: "optimized" | "skipped" | "fallback" | "retrieved" | "storage_failed";
  strategy: string;
  originalTokens: number;
  optimizedTokens: number;
  recoveredTokens: number;
  tokenizer: TokenizerInfo;
  processingTimeMs: number;
  createdAt: Date;
}

export interface EventSink {
  record(event: OptimizationEvent): void | Promise<void>;
}

// --- Engine (§12) -----------------------------------------------------------

export interface OptimizationStats {
  optimizations: number;
  skipped: number;
  fallbacks: number;
  retrievals: number;
  originalTokens: number;
  optimizedTokens: number;
  recoveredTokens: number;
  /** original - (optimized + recovered). May be negative. */
  netSavedTokens: number;
  tokenizer: TokenizerInfo;
}

export interface AgentContextEngine {
  optimize(
    input: ContextInput,
    options?: CompressionOptions,
    scope?: RetrievalScope,
  ): Promise<CompressionResult>;
  retrieve(request: RetrievalRequest, scope: RetrievalScope): Promise<RetrievalResult>;
  stats(filter?: { since?: Date; sessionId?: string }): Promise<OptimizationStats>;
}
