import type { CompressionOptions, Warning } from "@agentcontext/shared";

/**
 * Token budget rules (PRODUCT_SPEC R7–R9).
 *
 * - `maxTokens` is a budget for the returned content; `targetReduction` is the
 *   desired fraction of tokens removed (0–1).
 * - A budget never authorises omitting content: strategies still need an
 *   explicit selection to drop anything beyond exact repeats (R5).
 * - When the returned content does not meet the budget, the result carries a
 *   BUDGET_EXCEEDED warning; content is never truncated silently.
 */
export function hasBudget(options: CompressionOptions): boolean {
  return options.maxTokens !== undefined || options.targetReduction !== undefined;
}

/** True when `outputTokens` satisfies every budget set in `options`. */
export function meetsBudget(
  options: CompressionOptions,
  originalTokens: number,
  outputTokens: number,
): boolean {
  if (options.maxTokens !== undefined && outputTokens > options.maxTokens) return false;
  if (options.targetReduction !== undefined && originalTokens > 0) {
    const achieved = (originalTokens - outputTokens) / originalTokens;
    if (achieved + 1e-9 < options.targetReduction) return false;
  }
  return true;
}

/** BUDGET_EXCEEDED warning for content that misses the budget, or undefined if it is met. */
export function budgetWarning(
  options: CompressionOptions,
  originalTokens: number,
  outputTokens: number,
): Warning | undefined {
  if (!hasBudget(options) || meetsBudget(options, originalTokens, outputTokens)) return undefined;
  const parts: string[] = [];
  if (options.maxTokens !== undefined && outputTokens > options.maxTokens) {
    parts.push(`content is ${outputTokens} tokens, above maxTokens ${options.maxTokens}`);
  }
  if (options.targetReduction !== undefined && originalTokens > 0) {
    const achieved = Math.max(0, (originalTokens - outputTokens) / originalTokens);
    if (achieved + 1e-9 < options.targetReduction) {
      parts.push(
        `reduction ${percent(achieved)} is below targetReduction ${percent(options.targetReduction)}`,
      );
    }
  }
  return {
    code: "BUDGET_EXCEEDED",
    message: `Budget not met safely: ${parts.join("; ")}. Nothing was truncated; use a selection to omit more, or retrieve parts on demand.`,
  };
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}
