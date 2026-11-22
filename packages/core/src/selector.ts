import type {
  CompressionOptions,
  CompressionStrategy,
  Confidence,
  ContentAnalysis,
  NormalizedContext,
  StrategyAnalysis,
} from "@agentcontext/shared";
import { meetsBudget } from "./budget.js";
import type { StrategyRegistry } from "./strategy-registry.js";

export interface SelectorConfig {
  /** Content smaller than this (tokens) is not optimized unless a strategy or selection is explicit. */
  minOptimizeTokens: number;
  /** Default minimum estimated saving; overridden by `options.minBenefitTokens`. */
  minBenefitTokens: number;
}

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  minOptimizeTokens: 500,
  minBenefitTokens: 50,
};

export interface CandidateReport {
  strategy: string;
  supported: boolean;
  analysis?: StrategyAnalysis;
  error?: string;
}

export type SkipReason =
  | "BELOW_THRESHOLD"
  | "WITHIN_BUDGET"
  | "NO_SUPPORTED_STRATEGY"
  | "NO_BENEFIT"
  | "FORCED_STRATEGY_UNSUPPORTED";

export type Selection =
  | {
      kind: "selected";
      strategy: CompressionStrategy;
      analysis: StrategyAnalysis;
      candidates: CandidateReport[];
    }
  | { kind: "skip"; reason: SkipReason; message: string; candidates: CandidateReport[] };

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/**
 * Choose a strategy or skip (ARCHITECTURE.md §4). Deterministic: candidates are
 * ranked by budget fit, then confidence, then estimated saving, then
 * registration order. No
 * chaining — at most one strategy is selected.
 *
 * - A forced `options.strategy` must exist (else INVALID_INPUT is thrown) and
 *   must `supports()` the input; it bypasses the size threshold only.
 * - An explicit `options.selection` also bypasses the size threshold.
 * - A strategy whose `analyze()` throws is treated as not applicable.
 * - With a budget (`maxTokens` / `targetReduction`), candidates expected to meet
 *   it rank first; content already within `maxTokens` is not optimized unless
 *   a strategy or selection is explicit.
 */
export async function selectStrategy(
  context: NormalizedContext,
  analysis: ContentAnalysis,
  options: CompressionOptions,
  registry: StrategyRegistry,
  config: SelectorConfig = DEFAULT_SELECTOR_CONFIG,
): Promise<Selection> {
  const minBenefit = options.minBenefitTokens ?? config.minBenefitTokens;
  const forced = options.strategy !== undefined ? registry.get(options.strategy) : undefined;
  const explicit = forced !== undefined || options.selection !== undefined;

  if (
    !explicit &&
    options.maxTokens !== undefined &&
    analysis.tokens.count <= options.maxTokens &&
    options.targetReduction === undefined
  ) {
    return {
      kind: "skip",
      reason: "WITHIN_BUDGET",
      message: `Content already fits maxTokens (${options.maxTokens})`,
      candidates: [],
    };
  }

  if (!explicit && analysis.tokens.count < config.minOptimizeTokens) {
    return {
      kind: "skip",
      reason: "BELOW_THRESHOLD",
      message: `Content is below the optimization threshold (${config.minOptimizeTokens} tokens)`,
      candidates: [],
    };
  }

  const pool = forced ? [forced] : registry.list();
  const candidates: CandidateReport[] = [];
  const viable: { strategy: CompressionStrategy; analysis: StrategyAnalysis; order: number }[] = [];

  for (const [order, strategy] of pool.entries()) {
    let supported: boolean;
    try {
      supported = strategy.supports(context, analysis);
    } catch {
      supported = false;
    }
    if (!supported) {
      candidates.push({ strategy: strategy.name, supported: false });
      continue;
    }
    try {
      const result = await strategy.analyze(context, analysis, options);
      candidates.push({ strategy: strategy.name, supported: true, analysis: result });
      if (result.applicable && result.estimatedSavedTokens >= minBenefit) {
        viable.push({ strategy, analysis: result, order });
      }
    } catch (error) {
      candidates.push({
        strategy: strategy.name,
        supported: true,
        error: error instanceof Error ? error.name : "Error",
      });
    }
  }

  if (forced && candidates[0]?.supported === false) {
    return {
      kind: "skip",
      reason: "FORCED_STRATEGY_UNSUPPORTED",
      message: `Strategy "${forced.name}" does not support this content`,
      candidates,
    };
  }
  if (!candidates.some((c) => c.supported)) {
    return {
      kind: "skip",
      reason: "NO_SUPPORTED_STRATEGY",
      message: `No strategy supports content of type "${context.contentType}"`,
      candidates,
    };
  }
  if (viable.length === 0) {
    return {
      kind: "skip",
      reason: "NO_BENEFIT",
      message: `No strategy is expected to save at least ${minBenefit} tokens`,
      candidates,
    };
  }

  const original = analysis.tokens.count;
  const fits = (a: StrategyAnalysis) =>
    meetsBudget(options, original, a.estimatedOutputTokens) ? 1 : 0;
  viable.sort(
    (a, b) =>
      fits(b.analysis) - fits(a.analysis) ||
      CONFIDENCE_RANK[b.analysis.confidence] - CONFIDENCE_RANK[a.analysis.confidence] ||
      b.analysis.estimatedSavedTokens - a.analysis.estimatedSavedTokens ||
      a.order - b.order,
  );
  const best = viable[0] as (typeof viable)[number];
  return { kind: "selected", strategy: best.strategy, analysis: best.analysis, candidates };
}
