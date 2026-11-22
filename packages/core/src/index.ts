/**
 * @agentcontext/core — framework-independent optimization pipeline.
 */
export const packageName = "@agentcontext/core" as const;

export { analyze, MAX_DUPLICATE_GROUPS } from "./analyzer.js";
export { detectContentType } from "./detector.js";
export { type ContentTypeDetector, type NormalizeOptions, normalize } from "./normalizer.js";
export {
  type CandidateReport,
  DEFAULT_SELECTOR_CONFIG,
  type Selection,
  type SelectorConfig,
  type SkipReason,
  selectStrategy,
} from "./selector.js";
export { StrategyRegistry } from "./strategy-registry.js";
