import { describe, expect, it } from "vitest";
import { runBenchmarks, TARGETS, toMarkdown } from "../src/index.js";

describe("benchmark runner (v0.1 release gate)", () => {
  it("meets every v0.1 target on the committed datasets", async () => {
    const report = await runBenchmarks({ iterations: 2, now: new Date("2026-11-23T00:00:00Z") });

    expect(report.summary.scenarios).toBeGreaterThanOrEqual(4);
    expect(report.summary.medianReductionPct).toBeGreaterThanOrEqual(TARGETS.medianReductionPct);
    expect(report.summary.extractionAccuracyPct).toBeGreaterThanOrEqual(
      TARGETS.extractionAccuracyPct,
    );
    expect(report.summary.recoveryIntegrityPct).toBe(100);
    expect(report.summary.unrecoverableOmissions).toBe(0);
    expect(report.targets.every((t) => t.met)).toBe(true);

    for (const scenario of report.scenarios) {
      expect(scenario.taskSuccess, `${scenario.id} task success`).toBe(true);
      expect(scenario.totalTokens).toBe(scenario.optimizedTokens + scenario.recoveredTokens);
      expect(scenario.segmentsVerified).toBe(scenario.omittedSegments);
    }
    const withRecovery = report.scenarios.filter((s) => s.recoveredTokens > 0);
    expect(withRecovery.length).toBeGreaterThan(0);
  }, 120_000);

  it("renders a Markdown report with targets, scenarios and limitations", async () => {
    const report = await runBenchmarks({ iterations: 1, ids: ["source-code"] });
    const markdown = toMarkdown(report);
    expect(markdown).toContain("| source-code | code-extractor |");
    expect(markdown).toContain("## Limitations");
    expect(markdown).toContain("estimates");
  });
});
