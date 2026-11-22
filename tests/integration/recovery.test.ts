import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import {
  buildLineIndex,
  type CompressionOptions,
  lineRangeSpan,
  parseLocations,
  type RetrievalScope,
  resolveNormalizedPath,
} from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import {
  codeExtractor,
  duplicateEliminator,
  jsonPruner,
  logCompressor,
  sectionExtractor,
} from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { afterEach, describe, expect, it } from "vitest";

const scope: RetrievalScope = { workspaceId: "w", sessionId: "s", mode: "session" };
const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/strategies/test/fixtures/${name}`, import.meta.url), "utf8");

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function engine() {
  const directory = mkdtempSync(join(tmpdir(), "agentcontext-recovery-"));
  const storage = new SqliteStorage({ directory });
  cleanup.push(() => {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return createEngine({
    tokenizer: new FallbackEstimator(),
    strategies: [jsonPruner, logCompressor, duplicateEliminator, sectionExtractor, codeExtractor],
    storage,
  });
}

/** Independent computation of the original text a location refers to. */
function expected(original: string, location: string): string[] {
  const index = buildLineIndex(original);
  return parseLocations(location).map((part) => {
    if (part.kind === "lines") {
      const span = lineRangeSpan(original, index, part.start, part.end);
      return original.slice(span.start, span.end);
    }
    if (part.kind === "json") {
      const resolved = resolveNormalizedPath(JSON.parse(original), part.path);
      if (!resolved.found) throw new Error("unresolved");
      return JSON.stringify(resolved.value, null, 2);
    }
    if (part.kind === "offset") return original.slice(part.start, part.end);
    throw new Error("unexpected block location");
  });
}

const appendix = Array.from({ length: 120 }, (_, i) => `Appendix note ${i + 1}.`).join("\n");
const boilerplate =
  "This message was generated automatically by the reporting system.\nPlease contact support.";
const cases: [string, string, string, CompressionOptions][] = [
  [
    "json-pruner",
    fixture("api-response.json"),
    "json-pruner",
    { selection: { json: { include: ["$.meta"] } } },
  ],
  ["log-compressor (safe)", fixture("terminal.log"), "log-compressor", {}],
  [
    "log-compressor (levels)",
    fixture("terminal.log"),
    "log-compressor",
    { selection: { logs: {} } },
  ],
  [
    "duplicate-eliminator",
    Array.from({ length: 30 }, (_, i) => `Section ${i}.\n\n${boilerplate}`).join("\n\n"),
    "duplicate-eliminator",
    {},
  ],
  [
    "section-extractor",
    `${fixture("guide.md")}\n## Appendix\n\n${appendix}\n`,
    "section-extractor",
    { selection: { markdown: { sections: ["Installation"] } }, minBenefitTokens: 0 },
  ],
  [
    "code-extractor (lines)",
    fixture("module.ts"),
    "code-extractor",
    { selection: { lines: { ranges: [{ start: 10, end: 12 }] } }, minBenefitTokens: 0 },
  ],
  [
    "code-extractor (diff)",
    fixture("change.diff"),
    "code-extractor",
    { minBenefitTokens: 0, strategy: "code-extractor" },
  ],
];

describe("recovery: every recorded omission is recoverable exactly", () => {
  it.each(cases)("%s", async (_name, content, strategy, options) => {
    const e = engine();
    const result = await e.optimize({ content, source: "test" }, options, scope);
    expect(result.strategy).toBe(strategy);
    expect(result.recoveryAvailable).toBe(true);
    expect(result.omittedSegments.length).toBeGreaterThan(0);

    for (const segment of result.omittedSegments) {
      expect(segment.recoverable).toBe(true);
      const recovered = await e.retrieve(
        {
          contextId: result.contextId as string,
          selector: { type: "segment_id", value: segment.id },
        },
        scope,
      );
      expect(recovered.status).toBe("OK");
      if (recovered.status !== "OK") continue;
      expect(recovered.matches?.map((m) => m.text)).toEqual(expected(content, segment.location));
    }

    const full = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(full.status === "OK" && full.content).toBe(content);
  });
});
