/**
 * @agentcontext/core — framework-independent optimization pipeline.
 */
export const packageName = "@agentcontext/core" as const;

export { analyze, MAX_DUPLICATE_GROUPS } from "./analyzer.js";
export { budgetWarning, hasBudget, meetsBudget } from "./budget.js";
export { detectContentType } from "./detector.js";
export {
  createEngine,
  DEFAULT_ENGINE_CONFIG,
  type EngineConfig,
  type EngineDependencies,
} from "./engine.js";
export { newContextId, newVariantId, ulid } from "./ids.js";
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
export {
  type JsonPathResolver,
  type ValidationInput,
  type ValidationReport,
  type ValidatorConfig,
  validateOutput,
} from "./validator.js";
