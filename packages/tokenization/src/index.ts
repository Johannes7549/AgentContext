/**
 * @agentcontext/tokenization — tokenizer adapters, the fallback estimator and
 * a tokenizer registry (ADR-0003).
 */
export const packageName = "@agentcontext/tokenization" as const;

export { FallbackEstimator } from "./fallback-estimator.js";
export {
  countTokens,
  createDefaultRegistry,
  DEFAULT_TOKENIZER_ID,
  TokenizerRegistry,
  tokenizerInfo,
} from "./registry.js";
