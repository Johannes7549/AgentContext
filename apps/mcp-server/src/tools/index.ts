import type { Registrar } from "../server.js";
import { registerOptimizeContext } from "./optimize-context.js";
import { registerRetrieveContext } from "./retrieve-context.js";

export { formatOptimizeResult, OPTIMIZE_CONTEXT_DESCRIPTION } from "./optimize-context.js";
export { formatRetrieveResult, RETRIEVE_CONTEXT_DESCRIPTION } from "./retrieve-context.js";

/** Tools, resources and prompts registered on every server. */
export const defaultRegistrars: readonly Registrar[] = [
  registerOptimizeContext,
  registerRetrieveContext,
];
