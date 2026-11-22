import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import {
  buildLineIndex,
  type CompressionResult,
  lineRangeSpan,
  type OmittedSegment,
  parseLocations,
  type RetrievalScope,
  resolveNormalizedPath,
  type TokenizerInfo,
} from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import {
  codeExtractor,
  duplicateEliminator,
  jsonPruner,
  logCompressor,
  sectionExtractor,
} from "@agentcontext/strategies";
import { FallbackEstimator, tokenizerInfo } from "@agentcontext/tokenization";
import { checkFact } from "./facts.js";
import { loadScenario, SCENARIO_IDS, type Scenario } from "./scenario.js";

/** v0.1 engineering targets (roadmap §10) — targets, not guarantees. */
export const TARGETS = {
  medianReductionPct: 40,
  extractionAccuracyPct: 95,
  recoveryIntegrityPct: 100,
  unrecoverableOmissions: 0,
} as const;

export interface ScenarioResult {
  id: string;
  title: string;
  task: string;
  strategy: string;
  baselineTokens: number;
  optimizedTokens: number;
  recoveredTokens: number;
  totalTokens: number;
  /** 100 × (1 − total / baseline), recovery included. */
  reductionPct: number;
  retrievalCalls: number;
  facts: { id: string; passed: boolean }[];
  accuracyPct: number;
  taskSuccess: boolean;
  omittedSegments: number;
  segmentsVerified: number;
  unrecoverable: number;
  warnings: string[];
  latencyMs: { p50: number; p95: number; samples: number };
}

export interface BenchmarkReport {
  tool: "agentcontext";
  version: string;
  generatedAt: string;
  environment: { node: string; platform: string; arch: string };
  tokenizer: TokenizerInfo;
  iterations: number;
  scenarios: ScenarioResult[];
  summary: {
    scenarios: number;
    medianReductionPct: number;
    extractionAccuracyPct: number;
    taskSuccessRatePct: number;
    recoveryIntegrityPct: number;
    unrecoverableOmissions: number;
    latencyMs: { p50: number; p95: number };
  };
  targets: { name: string; target: string; actual: string; met: boolean }[];
  limitations: string[];
}

const scope: RetrievalScope = { workspaceId: "bench", sessionId: "bench", mode: "session" };

export async function runScenario(
  scenario: Scenario,
  input: string,
  iterations = 10,
): Promise<ScenarioResult> {
  const directory = mkdtempSync(join(tmpdir(), "agentcontext-bench-"));
  const storage = new SqliteStorage({ directory });
  try {
    const tokenizer = new FallbackEstimator();
    const engine = createEngine({
      tokenizer,
      strategies: [jsonPruner, logCompressor, duplicateEliminator, sectionExtractor, codeExtractor],
      storage,
    });
    const contextInput = {
      content: input,
      source: `benchmark:${scenario.id}`,
      ...(scenario.contentType ? { contentType: scenario.contentType } : {}),
    };

    const latencies: number[] = [];
    let result: CompressionResult | undefined;
    for (let i = 0; i < Math.max(1, iterations); i++) {
      const run = await engine.optimize(contextInput, scenario.options, scope);
      latencies.push(run.metrics.processingTimeMs);
      result ??= run;
    }
    const first = result as CompressionResult;
    const optimized =
      typeof first.content === "string" ? first.content : JSON.stringify(first.content);

    const recovered: string[] = [];
    let recoveredTokens = 0;
    for (const step of scenario.recovery) {
      if (!first.contextId) break;
      const r = await engine.retrieve(
        {
          contextId: first.contextId,
          ...(step.selector ? { selector: step.selector } : {}),
          ...(step.contextLines !== undefined ? { contextLines: step.contextLines } : {}),
        },
        scope,
      );
      if (r.status === "OK") {
        recovered.push(r.content);
        recoveredTokens += r.tokens.count;
      }
    }

    const evidence = { texts: [optimized, ...recovered], segments: first.omittedSegments };
    const facts = scenario.facts.map((fact) => ({
      id: fact.id,
      passed: checkFact(fact, evidence),
    }));
    const passed = facts.filter((f) => f.passed).length;

    const { verified, unrecoverable } = await verifySegments(
      engine,
      first.contextId,
      first.omittedSegments,
      input,
    );

    const baselineTokens = first.metrics.originalTokens;
    const totalTokens = first.metrics.optimizedTokens + recoveredTokens;
    return {
      id: scenario.id,
      title: scenario.title,
      task: scenario.task,
      strategy: first.strategy,
      baselineTokens,
      optimizedTokens: first.metrics.optimizedTokens,
      recoveredTokens,
      totalTokens,
      reductionPct: round1(baselineTokens === 0 ? 0 : 100 * (1 - totalTokens / baselineTokens)),
      retrievalCalls: scenario.recovery.length,
      facts,
      accuracyPct: round1((100 * passed) / Math.max(1, facts.length)),
      taskSuccess: passed === facts.length,
      omittedSegments: first.omittedSegments.length,
      segmentsVerified: verified,
      unrecoverable,
      warnings: first.warnings.map((w) => w.code),
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        samples: latencies.length,
      },
    };
  } finally {
    storage.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

/** Retrieve every omitted segment and compare it with an independent slice of the original. */
async function verifySegments(
  engine: ReturnType<typeof createEngine>,
  contextId: string | null,
  segments: OmittedSegment[],
  original: string,
): Promise<{ verified: number; unrecoverable: number }> {
  let verified = 0;
  let unrecoverable = 0;
  const index = buildLineIndex(original);
  for (const segment of segments) {
    if (!segment.recoverable) continue;
    if (!contextId) {
      unrecoverable++;
      continue;
    }
    const r = await engine.retrieve(
      { contextId, selector: { type: "segment_id", value: segment.id } },
      scope,
    );
    const expected = parseLocations(segment.location).map((part) => {
      if (part.kind === "lines") {
        const span = lineRangeSpan(original, index, part.start, part.end);
        return original.slice(span.start, span.end);
      }
      if (part.kind === "offset") return original.slice(part.start, part.end);
      if (part.kind === "json") {
        const resolved = resolveNormalizedPath(JSON.parse(original), part.path);
        return resolved.found ? JSON.stringify(resolved.value, null, 2) : "\u0000unresolved";
      }
      return "\u0000unsupported";
    });
    const ok =
      r.status === "OK" &&
      JSON.stringify(r.matches?.map((m) => m.text)) === JSON.stringify(expected);
    if (ok) verified++;
    else unrecoverable++;
  }
  return { verified, unrecoverable };
}

export async function runBenchmarks(
  options: { iterations?: number; ids?: readonly string[]; version?: string; now?: Date } = {},
): Promise<BenchmarkReport> {
  const iterations = options.iterations ?? 10;
  const results: ScenarioResult[] = [];
  for (const id of options.ids ?? SCENARIO_IDS) {
    const { scenario, input } = loadScenario(id);
    results.push(await runScenario(scenario, input, iterations));
  }

  const factsTotal = results.reduce((n, r) => n + r.facts.length, 0);
  const factsPassed = results.reduce((n, r) => n + r.facts.filter((f) => f.passed).length, 0);
  const segmentsTotal = results.reduce((n, r) => n + r.segmentsVerified + r.unrecoverable, 0);
  const segmentsOk = results.reduce((n, r) => n + r.segmentsVerified, 0);
  const summary = {
    scenarios: results.length,
    medianReductionPct: round1(median(results.map((r) => r.reductionPct))),
    extractionAccuracyPct: round1((100 * factsPassed) / Math.max(1, factsTotal)),
    taskSuccessRatePct: round1(
      (100 * results.filter((r) => r.taskSuccess).length) / Math.max(1, results.length),
    ),
    recoveryIntegrityPct: round1(segmentsTotal === 0 ? 100 : (100 * segmentsOk) / segmentsTotal),
    unrecoverableOmissions: results.reduce((n, r) => n + r.unrecoverable, 0),
    latencyMs: {
      p50: round1(median(results.map((r) => r.latencyMs.p50))),
      p95: round1(Math.max(...results.map((r) => r.latencyMs.p95))),
    },
  };
  const targets = [
    {
      name: "Median input reduction (incl. recovery)",
      target: `>= ${TARGETS.medianReductionPct}%`,
      actual: `${summary.medianReductionPct}%`,
      met: summary.medianReductionPct >= TARGETS.medianReductionPct,
    },
    {
      name: "Extraction accuracy",
      target: `>= ${TARGETS.extractionAccuracyPct}%`,
      actual: `${summary.extractionAccuracyPct}%`,
      met: summary.extractionAccuracyPct >= TARGETS.extractionAccuracyPct,
    },
    {
      name: "Recovery integrity",
      target: `${TARGETS.recoveryIntegrityPct}%`,
      actual: `${summary.recoveryIntegrityPct}%`,
      met: summary.recoveryIntegrityPct >= TARGETS.recoveryIntegrityPct,
    },
    {
      name: "Unrecoverable omissions",
      target: `${TARGETS.unrecoverableOmissions}`,
      actual: `${summary.unrecoverableOmissions}`,
      met: summary.unrecoverableOmissions <= TARGETS.unrecoverableOmissions,
    },
  ];

  return {
    tool: "agentcontext",
    version: options.version ?? "0.1.0",
    generatedAt: (options.now ?? new Date()).toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    tokenizer: tokenizerInfo(new FallbackEstimator()),
    iterations,
    scenarios: results,
    summary,
    targets,
    limitations: [
      "Token counts use the deterministic fallback estimator, not a provider tokenizer; they are estimates.",
      "Task success is measured by a deterministic oracle (required facts present in what the agent saw), not by a live model.",
      "Retrieval calls are scripted per scenario to model what an agent would request; real agents may retrieve more or less.",
      "Datasets are synthetic and generated deterministically; real-world outputs vary.",
      "Latency covers optimization in-process (including local storage) on the machine that ran the benchmark.",
    ],
  };
}

export function toMarkdown(report: BenchmarkReport): string {
  const s = report.summary;
  const rows = report.scenarios.map(
    (r) =>
      `| ${r.id} | ${r.strategy} | ${r.baselineTokens} | ${r.optimizedTokens} | ${r.recoveredTokens} | ${r.reductionPct}% | ${r.facts.filter((f) => f.passed).length}/${r.facts.length} | ${r.segmentsVerified}/${r.omittedSegments} | ${r.latencyMs.p50} / ${r.latencyMs.p95} |`,
  );
  const failed = report.scenarios.flatMap((r) =>
    r.facts.filter((f) => !f.passed).map((f) => `- ${r.id}: fact \`${f.id}\` not established`),
  );
  return [
    "# AgentContext benchmark report",
    "",
    `Version ${report.version} · ${report.generatedAt} · Node ${report.environment.node} on ${report.environment.platform}/${report.environment.arch} · tokenizer \`${report.tokenizer.id}\` (${report.tokenizer.isExact ? "exact" : "estimated"}) · ${report.iterations} iterations per scenario`,
    "",
    "## Summary",
    "",
    "| Target | Goal | Actual | Met |",
    "|---|---|---|---|",
    ...report.targets.map(
      (t) => `| ${t.name} | ${t.target} | ${t.actual} | ${t.met ? "yes" : "**no**"} |`,
    ),
    `| Task success rate | (reported) | ${s.taskSuccessRatePct}% | — |`,
    `| Latency p50 / worst p95 | (reported) | ${s.latencyMs.p50} ms / ${s.latencyMs.p95} ms | — |`,
    "",
    "## Scenarios",
    "",
    "Tokens: baseline = original input; optimized = returned content; recovered = content fetched by scripted retrieval calls. Reduction includes recovered tokens.",
    "",
    "| Scenario | Strategy | Baseline | Optimized | Recovered | Reduction | Facts | Segments verified | Latency p50/p95 (ms) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Failures and regressions",
    "",
    ...(failed.length ? failed : ["None."]),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((l) => `- ${l}`),
    "",
  ].join("\n");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round1(sorted[index] as number);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
