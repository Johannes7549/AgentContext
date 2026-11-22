import {
  type AgentContextEngine,
  AgentContextError,
  type CompressionMetrics,
  type CompressionOptions,
  CompressionOptionsSchema,
  type CompressionResult,
  type CompressionStrategy,
  type EventSink,
  type NormalizedContext,
  type OmittedSegment,
  type OptimizationEvent,
  type OptimizationStats,
  parseOrThrow,
  type RetrievalRequest,
  RetrievalRequestSchema,
  type RetrievalResult,
  type RetrievalScope,
  RetrievalScopeSchema,
  type StoragePort,
  type StrategyOutput,
  sha256Hex,
  type Tokenizer,
  type TokenizerInfo,
  type Warning,
} from "@agentcontext/shared";
import { countTokens, tokenizerInfo } from "@agentcontext/tokenization";
import { analyze } from "./analyzer.js";
import { newContextId, newVariantId } from "./ids.js";
import { normalize } from "./normalizer.js";
import { selectStrategy } from "./selector.js";
import { StrategyRegistry } from "./strategy-registry.js";
import { type JsonPathResolver, validateOutput } from "./validator.js";

export interface EngineConfig {
  /** Skip optimization below this many tokens (unless strategy/selection is explicit). */
  minOptimizeTokens: number;
  /** Default minimum estimated saving per request. */
  minBenefitTokens: number;
  /** Allowed growth of the optimized output, as a fraction. */
  sizeTolerance: number;
  /** On storage failure: return the original, or the optimized output marked non-recoverable. */
  storageFailurePolicy: "return_original" | "non_recoverable";
  /** Time to live of stored originals. */
  ttlMs: number;
  /** Maximum UTF-8 size of one input. */
  maxInputBytes: number;
  /** Clock (injectable for tests). */
  now: () => Date;
  /** Randomness for ids (injectable for tests). */
  randomBytes?: (size: number) => Uint8Array;
  /** Resolves `json:` locations during validation. */
  resolveJsonPath?: JsonPathResolver;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minOptimizeTokens: 500,
  minBenefitTokens: 50,
  sizeTolerance: 0,
  storageFailurePolicy: "return_original",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxInputBytes: 10 * 1024 * 1024,
  now: () => new Date(),
};

export interface EngineDependencies {
  tokenizer: Tokenizer;
  strategies: CompressionStrategy[];
  storage?: StoragePort;
  events?: EventSink;
  config?: Partial<EngineConfig>;
}

interface StatsRecord {
  event: OptimizationEvent;
  sessionId: string | undefined;
}

/**
 * Build the standalone optimization engine (CONTRACTS.md §12).
 *
 * `optimize` never returns unsafe transformed content: every failure path
 * returns the original with a warning (ARCHITECTURE.md §4 skip/fallback table).
 * `recoveryAvailable` is true only after the original has been stored and its
 * hash re-verified. Without storage, recoverable omissions require `allowLossy`
 * and are then reported as non-recoverable.
 */
export function createEngine(deps: EngineDependencies): AgentContextEngine {
  const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...stripUndefined(deps.config ?? {}) };
  const registry = new StrategyRegistry(deps.strategies);
  const { tokenizer, storage, events } = deps;
  const info = tokenizerInfo(tokenizer);
  const records: StatsRecord[] = [];

  const record = async (event: OptimizationEvent, sessionId: string | undefined) => {
    records.push({ event, sessionId });
    if (!events) return;
    try {
      await events.record(event);
    } catch {
      // Event sinks must never break optimization.
    }
  };

  async function optimize(
    input: unknown,
    rawOptions?: CompressionOptions,
    rawScope?: RetrievalScope,
  ): Promise<CompressionResult> {
    const started = performance.now();
    const options = parseOrThrow(CompressionOptionsSchema, rawOptions ?? {}, "compression options");
    const scope =
      rawScope === undefined ? undefined : parseOrThrow(RetrievalScopeSchema, rawScope, "scope");
    if (storage && !scope) {
      throw new AgentContextError(
        "INVALID_INPUT",
        "A retrieval scope is required when storage is configured",
      );
    }

    const context = normalize(input, { maxInputBytes: config.maxInputBytes });
    const analysis = await analyze(context, tokenizer);
    const originalTokens = analysis.tokens.count;
    const elapsed = () => Math.round((performance.now() - started) * 100) / 100;

    const passthrough = async (
      eventType: "skipped" | "fallback" | "storage_failed",
      warnings: Warning[],
    ): Promise<CompressionResult> => {
      const result: CompressionResult = {
        contextId: null,
        content: originalContent(context),
        metrics: metrics(originalTokens, originalTokens, info, elapsed()),
        strategy: "passthrough",
        recoveryAvailable: false,
        omittedSegments: [],
        warnings,
      };
      await record(
        event(eventType, null, "passthrough", result.metrics, config.now()),
        scope?.sessionId,
      );
      return result;
    };

    if (context.contentType === "mcp_content") {
      return passthrough("skipped", [
        warning("NO_SUPPORTED_STRATEGY", "MCP content blocks are passed through unchanged in v0.1"),
      ]);
    }

    const selection = await selectStrategy(context, analysis, options, registry, config);
    if (selection.kind === "skip") {
      const unsupported =
        selection.reason === "NO_SUPPORTED_STRATEGY" ||
        selection.reason === "FORCED_STRATEGY_UNSUPPORTED";
      return passthrough(
        "skipped",
        unsupported ? [warning("NO_SUPPORTED_STRATEGY", selection.message)] : [],
      );
    }
    const { strategy } = selection;

    let output: StrategyOutput;
    try {
      output = await strategy.compress(context, analysis, options);
    } catch (error) {
      return passthrough("fallback", [
        warning("VALIDATION_FAILED", `Strategy "${strategy.name}" failed (${errorName(error)})`),
      ]);
    }

    const optimizedTokens =
      typeof output.content === "string" ? (await countTokens(tokenizer, output.content)).count : 0;
    if (typeof output.content === "string" && optimizedTokens >= originalTokens) {
      return passthrough("fallback", [
        warning("NO_BENEFIT", "Optimized output was not smaller than the original"),
      ]);
    }

    const report = validateOutput(
      { context, output, strategy, options, originalTokens, optimizedTokens },
      {
        sizeTolerance: config.sizeTolerance,
        ...(config.resolveJsonPath ? { resolveJsonPath: config.resolveJsonPath } : {}),
      },
    );
    if (!report.valid) {
      const codes = [...new Set(report.issues.map((i) => i.code))].join(", ");
      return passthrough("fallback", [
        warning("VALIDATION_FAILED", `Output of "${strategy.name}" failed validation: ${codes}`),
      ]);
    }

    const warnings = [...output.warnings];
    let segments = output.omittedSegments;
    let contextId: string | null = null;
    let recoveryAvailable = false;

    if (!storage || !scope) {
      if (segments.some((s) => s.recoverable)) {
        if (options.allowLossy !== true) {
          return passthrough("fallback", [
            warning(
              "LOSSY_OMISSION",
              "Omitted content cannot be recovered because no storage is configured; set allowLossy to accept",
            ),
          ]);
        }
        segments = markNonRecoverable(segments);
        warnings.push(
          warning("LOSSY_OMISSION", "No storage is configured; omitted content is not recoverable"),
        );
      }
    } else {
      try {
        const now = config.now();
        const id = newContextId(now, config.randomBytes);
        await storage.putOriginal({
          contextId: id,
          workspaceId: scope.workspaceId,
          sessionId: scope.sessionId,
          content: context.original,
          contentHash: context.originalHash,
          contentType: context.contentType,
          source: context.source,
          expiresAt: new Date(now.getTime() + config.ttlMs),
        });
        const stored = await storage.getOriginal(id);
        if (sha256Hex(stored) !== context.originalHash) {
          throw new AgentContextError("INTEGRITY_ERROR", "Stored original does not match its hash");
        }
        await storage.putVariant({
          variantId: newVariantId(now, config.randomBytes),
          contextId: id,
          strategy: strategy.name,
          strategyVersion: strategy.version,
          optimizedContent: output.content,
          originalTokens,
          optimizedTokens,
          tokenizer: info,
          omittedSegments: segments,
        });
        contextId = id;
        recoveryAvailable = true;
      } catch (error) {
        await record(
          event(
            "storage_failed",
            null,
            strategy.name,
            metrics(originalTokens, optimizedTokens, info, elapsed()),
            config.now(),
          ),
          scope.sessionId,
        );
        const message = `Could not persist the original (${errorName(error)})`;
        if (config.storageFailurePolicy === "return_original") {
          return passthrough("fallback", [warning("STORAGE_FAILED", message)]);
        }
        segments = markNonRecoverable(segments);
        warnings.push(warning("STORAGE_FAILED", `${message}; omitted content is not recoverable`));
      }
    }

    const result: CompressionResult = {
      contextId,
      content: output.content,
      metrics: metrics(originalTokens, optimizedTokens, info, elapsed()),
      strategy: strategy.name,
      recoveryAvailable,
      omittedSegments: segments,
      warnings,
    };
    await record(
      event("optimized", contextId, strategy.name, result.metrics, config.now()),
      scope?.sessionId,
    );
    return result;
  }

  async function retrieve(
    rawRequest: RetrievalRequest,
    rawScope: RetrievalScope,
  ): Promise<RetrievalResult> {
    const request = parseOrThrow(RetrievalRequestSchema, rawRequest, "retrieval request");
    const scope = parseOrThrow(RetrievalScopeSchema, rawScope, "scope");
    const { contextId } = request;
    if (!storage) {
      return {
        status: "NOT_FOUND",
        contextId,
        message: "Recovery is unavailable: no storage is configured",
      };
    }
    if (request.selector) {
      return {
        status: "INVALID_SELECTOR",
        contextId,
        message:
          "Selective retrieval is not available yet; omit the selector to retrieve the full original",
      };
    }
    const stored = await storage.getContext(contextId);
    if (!stored) return { status: "NOT_FOUND", contextId, message: "Context not found" };
    if (
      stored.workspaceId !== scope.workspaceId ||
      (scope.mode === "session" && stored.sessionId !== scope.sessionId)
    ) {
      return { status: "UNAUTHORIZED", contextId, message: "Context is outside the current scope" };
    }
    if (stored.expiresAt.getTime() <= config.now().getTime()) {
      return { status: "EXPIRED", contextId, message: "Context has expired" };
    }
    let content: string;
    try {
      content = await storage.getOriginal(contextId);
    } catch {
      return {
        status: "INTEGRITY_ERROR",
        contextId,
        message: "Stored content could not be verified",
      };
    }
    if (sha256Hex(content) !== stored.contentHash) {
      return {
        status: "INTEGRITY_ERROR",
        contextId,
        message: "Stored content could not be verified",
      };
    }
    const tokens = await countTokens(tokenizer, content);
    if (request.maxTokens !== undefined && tokens.count > request.maxTokens) {
      return {
        status: "TOO_LARGE",
        contextId,
        message: `Content is ${tokens.count} tokens, above maxTokens ${request.maxTokens}`,
      };
    }
    await record(
      {
        contextId,
        eventType: "retrieved",
        strategy: "retrieval",
        originalTokens: 0,
        optimizedTokens: 0,
        recoveredTokens: tokens.count,
        tokenizer: info,
        processingTimeMs: 0,
        createdAt: config.now(),
      },
      scope.sessionId,
    );
    return { status: "OK", contextId, content, truncated: false, tokens };
  }

  async function stats(
    filter: { since?: Date; sessionId?: string } = {},
  ): Promise<OptimizationStats> {
    const selected = records.filter(
      ({ event: e, sessionId }) =>
        (filter.since === undefined || e.createdAt.getTime() >= filter.since.getTime()) &&
        (filter.sessionId === undefined || sessionId === filter.sessionId),
    );
    const sum = (pick: (e: OptimizationEvent) => number) =>
      selected.reduce((total, { event: e }) => total + pick(e), 0);
    const count = (type: OptimizationEvent["eventType"]) =>
      selected.filter(({ event: e }) => e.eventType === type).length;
    const counted = (e: OptimizationEvent) => e.eventType !== "storage_failed";
    const originalTokens = sum((e) => (counted(e) ? e.originalTokens : 0));
    const optimizedTokens = sum((e) => (counted(e) ? e.optimizedTokens : 0));
    const recoveredTokens = sum((e) => e.recoveredTokens);
    return {
      optimizations: count("optimized"),
      skipped: count("skipped"),
      fallbacks: count("fallback"),
      retrievals: count("retrieved"),
      originalTokens,
      optimizedTokens,
      recoveredTokens,
      netSavedTokens: originalTokens - (optimizedTokens + recoveredTokens),
      tokenizer: info,
    };
  }

  return { optimize, retrieve, stats };
}

function originalContent(context: NormalizedContext): CompressionResult["content"] {
  return context.blocks ? context.blocks.map((b) => b.block) : context.original;
}

function metrics(
  originalTokens: number,
  optimizedTokens: number,
  tokenizer: TokenizerInfo,
  processingTimeMs: number,
): CompressionMetrics {
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  return {
    originalTokens,
    optimizedTokens,
    savedTokens,
    reductionPercentage:
      originalTokens === 0 ? 0 : Math.round((savedTokens / originalTokens) * 1000) / 10,
    tokenCountIsExact: tokenizer.isExact,
    tokenizer,
    processingTimeMs,
  };
}

function event(
  eventType: OptimizationEvent["eventType"],
  contextId: string | null,
  strategy: string,
  m: CompressionMetrics,
  createdAt: Date,
): OptimizationEvent {
  return {
    contextId,
    eventType,
    strategy,
    originalTokens: m.originalTokens,
    optimizedTokens: m.optimizedTokens,
    recoveredTokens: 0,
    tokenizer: m.tokenizer,
    processingTimeMs: m.processingTimeMs,
    createdAt,
  };
}

function warning(code: Warning["code"], message: string): Warning {
  return { code, message };
}

function markNonRecoverable(segments: OmittedSegment[]): OmittedSegment[] {
  return segments.map((s) => ({ ...s, recoverable: false }));
}

function errorName(error: unknown): string {
  if (error instanceof AgentContextError) return error.code;
  return error instanceof Error ? error.name : "Error";
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
