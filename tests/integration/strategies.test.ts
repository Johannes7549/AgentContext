import { readFileSync } from "node:fs";
import { createEngine } from "@agentcontext/core";
import { CompressionResultSchema, type RetrievalScope } from "@agentcontext/shared";
import { jsonPruner } from "@agentcontext/strategies";
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
    engine: createEngine({ tokenizer: new FallbackEstimator(), strategies: [jsonPruner], storage }),
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
});
