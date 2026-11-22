import {
  AgentContextError,
  type TokenCount,
  type Tokenizer,
  type TokenizerInfo,
} from "@agentcontext/shared";
import { FallbackEstimator } from "./fallback-estimator.js";

export const DEFAULT_TOKENIZER_ID = "fallback-estimator";

export function tokenizerInfo(tokenizer: Tokenizer): TokenizerInfo {
  return { id: tokenizer.id, version: tokenizer.version, isExact: tokenizer.isExact };
}

/**
 * Count tokens and label the result with the tokenizer's identity (ADR-0003).
 * Rejects non-integer or negative counts from misbehaving adapters.
 */
export async function countTokens(tokenizer: Tokenizer, text: string): Promise<TokenCount> {
  const count = await tokenizer.countTokens(text);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new AgentContextError("INTERNAL", "Tokenizer returned an invalid count", {
      tokenizer: tokenizer.id,
    });
  }
  return { count, tokenizer: tokenizerInfo(tokenizer) };
}

/** Holds the available tokenizers. One tokenizer is used per request for all comparisons. */
export class TokenizerRegistry {
  readonly #tokenizers = new Map<string, Tokenizer>();

  register(tokenizer: Tokenizer): this {
    if (this.#tokenizers.has(tokenizer.id)) {
      throw new AgentContextError("INVALID_INPUT", "Tokenizer is already registered", {
        tokenizer: tokenizer.id,
      });
    }
    this.#tokenizers.set(tokenizer.id, tokenizer);
    return this;
  }

  has(id: string): boolean {
    return this.#tokenizers.has(id);
  }

  get(id: string): Tokenizer {
    const tokenizer = this.#tokenizers.get(id);
    if (!tokenizer) {
      throw new AgentContextError("INVALID_INPUT", "Unknown tokenizer", {
        tokenizer: id,
        available: this.list().map((t) => t.id),
      });
    }
    return tokenizer;
  }

  list(): TokenizerInfo[] {
    return [...this.#tokenizers.values()].map(tokenizerInfo);
  }
}

/** Registry containing the fallback estimator. */
export function createDefaultRegistry(): TokenizerRegistry {
  return new TokenizerRegistry().register(new FallbackEstimator());
}
