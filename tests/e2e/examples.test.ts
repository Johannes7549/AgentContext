import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(root, "apps", "mcp-server", "dist", "cli.js");
const run = (script: string) =>
  execFileSync(process.execPath, [join(root, script)], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });

type McpConfig = {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
};
const config = (name: string) =>
  JSON.parse(readFileSync(join(root, "examples", "claude-code", name), "utf8")) as McpConfig;

describe("examples", () => {
  it("basic-mcp-client optimizes, recovers and reports stats", () => {
    const output = run("examples/basic-mcp-client/client.mjs");
    expect(output).toContain(
      "tools: optimize_context, retrieve_context, read_file, get_optimization_stats",
    );
    expect(output).toContain("[... s1: repeated 399 more times");
    expect(output).toContain("ERROR src/app.ts(12,5)");
    expect(output).toContain("recovered s1: 399 original lines");
    expect(output).toMatch(/Optimizations: 1 .*retrievals: 1/);
  });

  it("custom-agent uses the engine directly with selection, JSONPath recovery and scope", () => {
    const output = run("examples/custom-agent/agent.mjs");
    expect(output).toContain("strategy: json-pruner");
    expect(output).toContain("failed jobs: job_42");
    expect(output).toContain("runner of job_42: runner-1");
    expect(output).toContain("other session: UNAUTHORIZED");
  });

  it.each([".mcp.json", ".mcp.windows.json"])(
    "claude-code/%s launches the published package",
    (name) => {
      const server = config(name).mcpServers.agentcontext;
      expect(server).toBeDefined();
      expect(server?.args).toContain("@agentcontext/mcp-server");
      expect(server?.args).toContain("-y");
      if (name.includes("windows")) expect(server?.command).toBe("cmd");
      else expect(server?.command).toBe("npx");
    },
  );

  it("claude-code settings start a working server (with the local build in place of npx)", async () => {
    const env = config(".mcp.json").mcpServers.agentcontext?.env ?? {};
    const storage = mkdtempSync(join(tmpdir(), "agentcontext-e2e-"));
    const client = new Client({ name: "examples-e2e", version: "1.0.0" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [cli],
          env: {
            ...(process.env as Record<string, string>),
            ...env,
            AGENTCONTEXT_STORAGE_DIR: storage,
          },
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("optimize_context");
      const prompt = await client.getPrompt({ name: "agentcontext_guidelines" });
      expect(JSON.stringify(prompt)).toContain("retrieve_context");
    } finally {
      await client.close();
      rmSync(storage, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });

  it("CLAUDE.md snippet names the tools that exist", () => {
    const text = readFileSync(join(root, "examples", "claude-code", "CLAUDE.md"), "utf8");
    for (const tool of ["optimize_context", "read_file", "retrieve_context"])
      expect(text).toContain(tool);
  });
});
