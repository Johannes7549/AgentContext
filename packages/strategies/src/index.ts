/**
 * @agentcontext/strategies — deterministic compression strategies (roadmap §5).
 * Strategies are pure: no I/O, clock, randomness or LLM calls (ADR-0001).
 */
export const packageName = "@agentcontext/strategies" as const;

export {
  jsonPruner,
  MAX_CHILD_SEGMENTS_PER_CONTAINER,
  MAX_SUPPORTED_DEPTH,
} from "./json-pruner.js";
export { DEFAULT_KEPT_LEVELS, logCompressor, messageKey } from "./log-compressor.js";
export {
  defineStrategy,
  describeRanges,
  estimateTokens,
  marker,
  type Plan,
  SegmentIds,
  type StrategyDefinition,
  toRanges,
} from "./util.js";
