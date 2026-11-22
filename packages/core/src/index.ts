/**
 * @agentcontext/core — framework-independent optimization pipeline.
 */
export const packageName = "@agentcontext/core" as const;

export { analyze, MAX_DUPLICATE_GROUPS } from "./analyzer.js";
export { detectContentType } from "./detector.js";
export { type ContentTypeDetector, type NormalizeOptions, normalize } from "./normalizer.js";
