/**
 * @agentcontext/benchmarks — reproducible, deterministic benchmark scenarios
 * and runner (roadmap §10). Private; not published.
 */
export const packageName = "@agentcontext/benchmarks" as const;

export { checkFact, countOccurrences, type Evidence } from "./facts.js";
export { buildScenarios, writeDatasets } from "./generate.js";
export {
  type BenchmarkReport,
  runBenchmarks,
  runScenario,
  type ScenarioResult,
  TARGETS,
  toMarkdown,
} from "./runner.js";
export { DATASETS_DIR, type Fact, loadScenario, SCENARIO_IDS, type Scenario } from "./scenario.js";
