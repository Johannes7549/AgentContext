/**
 * @agentcontext/observability — content-free logging, event persistence and
 * stats aggregation. No telemetry: nothing leaves the machine.
 */
export const packageName = "@agentcontext/observability" as const;

export {
  CONTENT_FIELDS,
  createLogger,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  redact,
  redactString,
  silentLogger,
} from "./logger.js";
export { aggregateStats, createPersistentEventSink, type EventStore } from "./stats.js";
