import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildScenarios,
  checkFact,
  DATASETS_DIR,
  loadScenario,
  SCENARIO_IDS,
  writeDatasets,
} from "../src/index.js";

describe("benchmark datasets", () => {
  it("covers at least the five required fixture types", () => {
    expect(SCENARIO_IDS.length).toBeGreaterThanOrEqual(5);
    for (const required of [
      "terminal-large",
      "api-responses",
      "duplicate-heavy",
      "documentation",
      "source-code",
    ]) {
      expect(SCENARIO_IDS).toContain(required);
    }
  });

  it("is reproducible: committed datasets equal freshly generated ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcontext-datasets-"));
    try {
      writeDatasets(dir);
      for (const { scenario, files } of buildScenarios()) {
        for (const name of [...Object.keys(files), "scenario.json"]) {
          expect(
            readFileSync(join(DATASETS_DIR, scenario.id, name), "utf8"),
            `${scenario.id}/${name}`,
          ).toBe(readFileSync(join(dir, scenario.id, name), "utf8"));
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(SCENARIO_IDS)("%s: every ground-truth fact holds on the original input", (id) => {
    const { scenario, input } = loadScenario(id);
    expect(scenario.facts.length).toBeGreaterThan(0);
    for (const fact of scenario.facts) {
      expect(checkFact(fact, { texts: [input], segments: [] }), `${id}/${fact.id}`).toBe(true);
    }
  });

  it("contains no real-looking secrets or personal data", () => {
    for (const id of SCENARIO_IDS) {
      const { input } = loadScenario(id);
      expect(input).not.toMatch(/sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/);
      for (const email of input.match(/[\w.+-]+@[A-Za-z][\w-]*\.[A-Za-z]{2,}\b/g) ?? []) {
        expect(email.endsWith("@example.com")).toBe(true);
      }
    }
  });
});

describe("fact oracle", () => {
  it("evaluates each fact kind", () => {
    expect(
      checkFact({ id: "a", kind: "contains", text: "x" }, { texts: ["axb"], segments: [] }),
    ).toBe(true);
    expect(
      checkFact(
        { id: "b", kind: "json-record", array: "data", match: { id: 1 }, expect: { v: 2 } },
        { texts: ['{"data":[{"id":1,"v":2}]}'], segments: [] },
      ),
    ).toBe(true);
    expect(
      checkFact(
        { id: "c", kind: "occurrences", text: "zz", count: 3 },
        {
          texts: ["zz"],
          segments: [
            {
              id: "s1",
              type: "duplicate_block",
              location: "lines:1-1",
              reason: "duplicate",
              recoverable: true,
              occurrences: 3,
            },
          ],
        },
      ),
    ).toBe(true);
    expect(
      checkFact({ id: "d", kind: "contains", text: "missing" }, { texts: ["x"], segments: [] }),
    ).toBe(false);
  });
});
