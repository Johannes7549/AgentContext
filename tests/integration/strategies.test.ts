import { readFileSync } from "node:fs";
import { createEngine } from "@agentcontext/core";
import { CompressionResultSchema, type RetrievalScope } from "@agentcontext/shared";
import {
  codeExtractor,
  duplicateEliminator,
  jsonPruner,
  logCompressor,
  sectionExtractor,
} from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../packages/core/test/helpers/memory-storage.js";

const scope: RetrievalScope = { workspaceId: "w", sessionId: "s", mode: "session" };
const fixture = (name: string) =>
  readFileSync(new URL(`../../packages/strategies/test/fixtures/${name}`, import.meta.url), "utf8");

function engine() {
  const storage = new MemoryStorage();
  return {
    storage,
    engine: createEngine({
      tokenizer: new FallbackEstimator(),
      strategies: [jsonPruner, logCompressor, duplicateEliminator, sectionExtractor, codeExtractor],
      storage,
    }),
  };
}

describe("strategies through the engine (generic validator applies)", () => {
  it("json-pruner: selected fields, recoverable omissions, exact original", async () => {
    const { engine: e } = engine();
    const content = fixture("api-response.json");
    const result = await e.optimize(
      { content, source: "tool:api" },
      { selection: { json: { include: ["$.data.customers[*].email"] } } },
      scope,
    );
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
    expect(result.strategy).toBe("json-pruner");
    expect(result.warnings).toEqual([]);
    expect(result.recoveryAvailable).toBe(true);
    expect(JSON.parse(result.content as string)).toEqual({
      data: {
        customers: [
          { email: "ada@example.com" },
          { email: "alan@example.com" },
          { email: "grace@example.com" },
        ],
      },
    });
    const recovered = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);
  });

  it("log-compressor: groups repeats, keeps errors, recovers the exact original", async () => {
    const { engine: e } = engine();
    const content = fixture("terminal.log");
    const result = await e.optimize({ content, source: "command:pnpm test" }, {}, scope);
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
    expect(result.strategy).toBe("log-compressor");
    expect(result.warnings).toEqual([]);
    expect(result.metrics.optimizedTokens).toBeLessThan(result.metrics.originalTokens);
    expect(result.content).toContain("TypeError: Cannot read properties of undefined");
    const recovered = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);
  });

  it("duplicate-eliminator: collapses repeated paragraphs and log-compressor still wins on logs", async () => {
    const { engine: e } = engine();
    const boilerplate = [
      "This message was generated automatically by the reporting system.",
      "Please do not reply directly; contact the support team instead.",
    ].join("\n");
    const content = Array.from(
      { length: 30 },
      (_, i) => `Report section ${i + 1} with unique findings.\n\n${boilerplate}`,
    ).join("\n\n");
    const result = await e.optimize(
      { content, contentType: "text", source: "tool:report" },
      {},
      scope,
    );
    expect(result.strategy).toBe("duplicate-eliminator");
    expect(result.warnings).toEqual([]);
    expect(result.omittedSegments[0]?.occurrences).toBe(30);
    const recovered = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);

    const logResult = await e.optimize(
      { content: fixture("terminal.log"), source: "command:test" },
      {},
      scope,
    );
    expect(logResult.strategy).toBe("log-compressor");
  });

  it("section-extractor: returns only the requested section (explicit selection bypasses size threshold)", async () => {
    const { engine: e } = engine();
    const appendix = Array.from(
      { length: 120 },
      (_, i) => `Appendix note ${i + 1}: background detail that is rarely needed.`,
    ).join("\n");
    const content = `${fixture("guide.md")}\n## Appendix\n\n${appendix}\n`;
    const result = await e.optimize(
      { content, source: "file:guide.md" },
      { selection: { markdown: { sections: ["Configuration"] } }, minBenefitTokens: 0 },
      scope,
    );
    expect(result.strategy).toBe("section-extractor");
    expect(result.warnings).toEqual([]);
    expect(result.content).toContain("Set allowed roots.");
    expect(result.content).not.toContain("Run the installer.");
    const recovered = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);
  });

  it("code-extractor: numbered line ranges pass the generic validator", async () => {
    const { engine: e } = engine();
    const content = fixture("module.ts");
    const result = await e.optimize(
      { content, source: "file:module.ts" },
      { selection: { lines: { ranges: [{ start: 20, end: 22 }] } }, minBenefitTokens: 0 },
      scope,
    );
    expect(result.strategy).toBe("code-extractor");
    expect(result.warnings).toEqual([]);
    expect(result.content).toContain("21 | function f21() { return 21; }");
    const recovered = await e.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);
  });
});
