import { randomUUID } from "node:crypto";
import { createEngine } from "@agentcontext/core";
import { createLogger, createPersistentEventSink, type Logger } from "@agentcontext/observability";
import type { AgentContextEngine, RetrievalScope, Tokenizer } from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import {
  codeExtractor,
  duplicateEliminator,
  jsonPruner,
  logCompressor,
  sectionExtractor,
} from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
import type { ServerConfig } from "./config.js";

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Everything a running server needs; created once per process. */
export interface Runtime {
  config: ServerConfig;
  logger: Logger;
  tokenizer: Tokenizer;
  storage: SqliteStorage;
  engine: AgentContextEngine;
  /** Supplied by the server, never by tool arguments (ADR-0006). */
  scope: RetrievalScope;
  close(): void;
}

export interface RuntimeOptions {
  sessionId?: string;
  logger?: Logger;
  /** Disable the periodic cleanup timer (tests). */
  periodicCleanup?: boolean;
}

export function createRuntime(config: ServerConfig, options: RuntimeOptions = {}): Runtime {
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  const sessionId = options.sessionId ?? `sess_${randomUUID()}`;
  const storage = new SqliteStorage({
    directory: config.storageDir,
    quotaBytes: Math.floor(config.quotaMb * 1024 * 1024),
  });
  const tokenizer = new FallbackEstimator();
  const engine = createEngine({
    tokenizer,
    strategies: [jsonPruner, logCompressor, duplicateEliminator, sectionExtractor, codeExtractor],
    storage,
    events: createPersistentEventSink({ store: storage.metadata, sessionId, logger }),
    config: {
      minOptimizeTokens: config.minOptimizeTokens,
      minBenefitTokens: config.minBenefitTokens,
      storageFailurePolicy: config.storageFailurePolicy,
      ttlMs: Math.round(config.ttlHours * 60 * 60 * 1000),
      maxInputBytes: config.maxInputBytes,
    },
  });

  const runCleanup = () => {
    storage
      .cleanup(new Date())
      .then((report) => {
        if (report.removedContexts > 0 || report.orphanBlobsRemoved > 0) {
          logger.info("storage cleanup", { ...report });
        }
      })
      .catch((error: unknown) => logger.warn("storage cleanup failed", { error }));
  };
  runCleanup();
  const timer =
    options.periodicCleanup === false ? undefined : setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  timer?.unref();

  let closed = false;
  return {
    config,
    logger,
    tokenizer,
    storage,
    engine,
    scope: { workspaceId: config.workspaceId, sessionId, mode: config.retrievalScope },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      storage.close();
    },
  };
}
