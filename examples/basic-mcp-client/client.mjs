/**
 * Basic MCP client: starts the AgentContext server over stdio, optimizes a
 * noisy log, recovers an omitted segment, and prints the stats.
 *
 *   pnpm build && node examples/basic-mcp-client/client.mjs
 *
 * Set AGENTCONTEXT_SERVER to the server command (default: the local build).
 * With the published package use: AGENTCONTEXT_SERVER="npx -y @agentcontext/mcp-server".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const localServer = fileURLToPath(new URL("../../apps/mcp-server/dist/cli.js", import.meta.url));
const [command, ...args] = process.env.AGENTCONTEXT_SERVER?.split(" ") ?? [
  process.execPath,
  localServer,
];
const storageDir = mkdtempSync(join(tmpdir(), "agentcontext-example-"));

const client = new Client({ name: "basic-mcp-client-example", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command,
    args,
    env: { ...process.env, AGENTCONTEXT_STORAGE_DIR: storageDir, AGENTCONTEXT_LOG_LEVEL: "warn" },
  }),
);

try {
  const tools = await client.listTools();
  console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  // A noisy build log: 400 identical progress lines around one real error.
  const log = [
    ...Array.from(
      { length: 200 },
      (_, i) => `2026-11-23T10:00:${String(i % 60).padStart(2, "0")}Z INFO compiling module`,
    ),
    "2026-11-23T10:04:00Z ERROR src/app.ts(12,5): Type 'string' is not assignable to type 'number'.",
    ...Array.from({ length: 200 }, () => "2026-11-23T10:04:01Z INFO compiling module"),
  ].join("\n");

  const optimized = await client.callTool({
    name: "optimize_context",
    arguments: { content: log, source: "command:tsc" },
  });
  console.log("\n--- optimized ---");
  console.log(optimized.content[0].text);

  const { contextId, omittedSegments, metrics } = optimized.structuredContent;
  console.log(`\nsaved ${metrics.savedTokens} of ${metrics.originalTokens} tokens (estimated)`);

  const recovered = await client.callTool({
    name: "retrieve_context",
    arguments: { contextId, selector: { type: "segment_id", value: omittedSegments[0].id } },
  });
  const recoveredLines = recovered.content[0].text.split("\n").filter(Boolean).length;
  console.log(`recovered ${omittedSegments[0].id}: ${recoveredLines} original lines`);

  const stats = await client.callTool({ name: "get_optimization_stats", arguments: {} });
  console.log(`\n--- stats ---\n${stats.content[0].text}`);
} finally {
  await client.close();
  rmSync(storageDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
