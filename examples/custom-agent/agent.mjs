/**
 * Using the AgentContext engine directly from TypeScript/JavaScript, without
 * MCP — for custom agents and tools.
 *
 *   pnpm build && node examples/custom-agent/agent.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import { SqliteStorage } from "@agentcontext/storage";
import { jsonPruner, logCompressor } from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";

const storageDir = mkdtempSync(join(tmpdir(), "agentcontext-agent-"));
const storage = new SqliteStorage({ directory: storageDir });
const engine = createEngine({
  tokenizer: new FallbackEstimator(),
  strategies: [jsonPruner, logCompressor],
  storage,
});
// The scope decides who may recover stored content (never take it from model output).
const scope = { workspaceId: "my-agent", sessionId: "run-1", mode: "session" };

try {
  // 1. A large API response; the agent only needs ids and statuses.
  const response = JSON.stringify({
    items: Array.from({ length: 100 }, (_, i) => ({
      id: `job_${i + 1}`,
      status: i === 41 ? "failed" : "succeeded",
      logs_url: `https://ci.example.com/jobs/${i + 1}/logs`,
      runner: { name: `runner-${i % 4}`, os: "linux", labels: ["x64", "docker"] },
      timings: { queued_ms: 1200 + i, run_ms: 54000 + i * 13 },
    })),
  });

  const result = await engine.optimize(
    { content: response, source: "tool:list_jobs" },
    { selection: { json: { include: ["$.items[*].id", "$.items[*].status"] } } },
    scope,
  );
  const items = JSON.parse(result.content).items;
  console.log(`strategy: ${result.strategy}`);
  console.log(
    `tokens: ${result.metrics.originalTokens} -> ${result.metrics.optimizedTokens} (estimated)`,
  );
  console.log(
    `failed jobs: ${items
      .filter((j) => j.status === "failed")
      .map((j) => j.id)
      .join(", ")}`,
  );

  // 2. Later the agent needs one omitted detail: recover it by JSONPath.
  const runner = await engine.retrieve(
    {
      contextId: result.contextId,
      selector: { type: "json_path", value: "$.items[41].runner.name" },
    },
    scope,
  );
  console.log(
    `runner of job_42: ${runner.status === "OK" ? JSON.parse(runner.content) : runner.status}`,
  );

  // 3. Another session cannot read this context.
  const other = await engine.retrieve(
    { contextId: result.contextId },
    { ...scope, sessionId: "run-2" },
  );
  console.log(`other session: ${other.status}`);

  const stats = await engine.stats();
  console.log(`net saved: ${stats.netSavedTokens} tokens (estimated)`);
} finally {
  storage.close();
  rmSync(storageDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
