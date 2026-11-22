import type { Registrar } from "../server.js";
import { registerGuidelines } from "./guidelines.js";
import { registerOptimizeContext } from "./optimize-context.js";
import { registerResources } from "./resources.js";
import { registerRetrieveContext } from "./retrieve-context.js";
import { registerStats } from "./stats.js";

export { GUIDELINES } from "./guidelines.js";
export { formatOptimizeResult, OPTIMIZE_CONTEXT_DESCRIPTION } from "./optimize-context.js";
export { formatRetrieveResult, RETRIEVE_CONTEXT_DESCRIPTION } from "./retrieve-context.js";
export { collectStats, formatStats, STATS_DESCRIPTION } from "./stats.js";

/** Tools, resources and prompts registered on every server. */
export const defaultRegistrars: readonly Registrar[] = [
  registerOptimizeContext,
  registerRetrieveContext,
  registerStats,
  registerResources,
  registerGuidelines,
];
