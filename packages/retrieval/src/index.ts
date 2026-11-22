/**
 * @agentcontext/retrieval — selective, scoped, size-limited recovery of
 * original content (CONTRACTS.md §9, ADR-0006).
 */
export const packageName = "@agentcontext/retrieval" as const;

export {
  DEFAULT_MAX_KEYWORD_MATCHES,
  DEFAULT_MAX_RESPONSE_BYTES,
  type RetrievalOptions,
  retrieveContext,
} from "./retrieve.js";
