import type {
  EventSink,
  OptimizationEvent,
  OptimizationStats,
  TokenizerInfo,
} from "@agentcontext/shared";
import { type Logger, silentLogger } from "./logger.js";

/** Structural interface satisfied by @agentcontext/storage's MetadataStore. */
export interface EventStore {
  insertEvent(event: OptimizationEvent, sessionId?: string | null): void;
  listEvents(filter?: { since?: Date; sessionId?: string }): OptimizationEvent[];
}

/**
 * Aggregate events into OptimizationStats (CONTRACTS.md §12).
 *
 * Token totals only include events measured with `tokenizer` (same id and
 * version), so figures from different tokenizers are never mixed.
 * `storage_failed` events are counted separately by the pipeline's fallback
 * event and contribute no tokens. `netSavedTokens` may be negative when more
 * content was recovered than saved.
 */
export function aggregateStats(
  events: readonly OptimizationEvent[],
  tokenizer: TokenizerInfo,
): OptimizationStats {
  const same = (e: OptimizationEvent) =>
    e.tokenizer.id === tokenizer.id && e.tokenizer.version === tokenizer.version;
  const counted = events.filter((e) => e.eventType !== "storage_failed" && same(e));
  const count = (type: OptimizationEvent["eventType"]) =>
    events.filter((e) => e.eventType === type).length;
  const sum = (pick: (e: OptimizationEvent) => number) =>
    counted.reduce((total, e) => total + pick(e), 0);
  const originalTokens = sum((e) => e.originalTokens);
  const optimizedTokens = sum((e) => e.optimizedTokens);
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
    tokenizer,
  };
}

/**
 * EventSink that persists events (tagged with the server's session id) and
 * logs a content-free debug line. Persistence errors are logged, never thrown.
 */
export function createPersistentEventSink(options: {
  store: EventStore;
  sessionId: string;
  logger?: Logger;
}): EventSink {
  const logger = options.logger ?? silentLogger;
  return {
    record(event) {
      try {
        options.store.insertEvent(event, options.sessionId);
      } catch (error) {
        logger.warn("Could not persist optimization event", { error, eventType: event.eventType });
      }
      logger.debug("optimization event", {
        eventType: event.eventType,
        strategy: event.strategy,
        contextId: event.contextId,
        originalTokens: event.originalTokens,
        optimizedTokens: event.optimizedTokens,
        recoveredTokens: event.recoveredTokens,
        processingTimeMs: event.processingTimeMs,
      });
    },
  };
}
