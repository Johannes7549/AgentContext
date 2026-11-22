import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../apps/mcp-server/dist/cli.js", import.meta.url));
const log = readFileSync(
  new URL("../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../../packages/strategies/test/fixtures/api-response.json", import.meta.url),
  "utf8",
);

type TextResult = {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const text = (result: unknown) => ((result as TextResult).content[0]?.text ?? "") as string;

let dir: string;
let client: Client;
let stderr = "";

async function connect(extraEnv: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    cwd: dir,
    env: {
      ...(process.env as Record<string, string>),
      AGENTCONTEXT_STORAGE_DIR: join(dir, "store"),
      AGENTCONTEXT_LOG_LEVEL: "info",
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const c = new Client({ name: "agentcontext-integration", version: "1.0.0" });
  await c.connect(transport);
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return c;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "agentcontext-mcp-it-"));
  client = await connect();
});

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AgentContext MCP server over stdio (official client)", () => {
  it("identifies itself and exposes tools, resources and the prompt", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "agentcontext", version: "0.1.0" });
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "get_optimization_stats",
      "optimize_context",
      "retrieve_context",
    ]);
    for (const tool of tools.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toBeDefined();
    }
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
      "agentcontext://stats",
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(1);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual([
      "agentcontext_guidelines",
    ]);
  });

  it("optimizes a log and recovers segments and the exact original", async () => {
    const result = (await client.callTool({
      name: "optimize_context",
      arguments: { content: log, source: "command:pnpm test" },
    })) as TextResult;
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("[... s1:");
    const contextId = result.structuredContent?.contextId as string;
    expect(contextId).toMatch(/^ctx_/);

    const segment = await client.callTool({
      name: "retrieve_context",
      arguments: { contextId, selector: { type: "segment_id", value: "s1" } },
    });
    expect(text(segment)).toContain("GET /health 200 2ms");

    const full = await client.callTool({ name: "retrieve_context", arguments: { contextId } });
    expect(text(full)).toBe(log);
  });

  it("extracts JSON fields with a selection and recovers by JSONPath", async () => {
    const result = (await client.callTool({
      name: "optimize_context",
      arguments: {
        content: api,
        options: {
          selection: { json: { include: ["$.data.customers[*].email"] } },
          minBenefitTokens: 0,
        },
      },
    })) as TextResult;
    expect(result.structuredContent?.strategy).toBe("json-pruner");
    const body = text(result).split("\n---\n")[0] ?? "";
    expect(JSON.parse(body)).toEqual({
      data: {
        customers: [
          { email: "ada@example.com" },
          { email: "alan@example.com" },
          { email: "grace@example.com" },
        ],
      },
    });
    const byPath = await client.callTool({
      name: "retrieve_context",
      arguments: {
        contextId: result.structuredContent?.contextId,
        selector: { type: "json_path", value: "$.meta.request_id" },
      },
    });
    expect(text(byPath)).toBe('"req_abc123"');
  });

  it("returns structured errors as isError results", async () => {
    const missing = (await client.callTool({
      name: "retrieve_context",
      arguments: { contextId: "ctx_01JD0000000000000000000000" },
    })) as TextResult;
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/^NOT_FOUND:/);

    const invalid = (await client.callTool({
      name: "optimize_context",
      arguments: { content: "x", options: { targetReduction: 5 } },
    })) as TextResult;
    expect(invalid.isError).toBe(true);
  });

  it("serves stats, metadata resources and the guidelines prompt", async () => {
    const stats = (await client.callTool({
      name: "get_optimization_stats",
      arguments: {},
    })) as TextResult;
    expect(stats.structuredContent).toMatchObject({ optimizations: 2, retrievals: 3 });

    const read = await client.readResource({ uri: "agentcontext://stats" });
    const body = JSON.parse((read.contents[0] as { text: string }).text);
    expect(body.session.optimizations).toBe(2);

    const prompt = await client.getPrompt({ name: "agentcontext_guidelines" });
    expect(JSON.stringify(prompt.messages)).toContain("untrusted data");
  });

  it("keeps logs on stderr without raw content", () => {
    expect(stderr).toContain("AgentContext MCP server started");
    expect(stderr).not.toContain("connection refused");
    expect(stderr).not.toContain("ada@example.com");
  });

  it("keeps omitted content recoverable across a server restart (workspace scope)", async () => {
    const first = (await client.callTool({
      name: "optimize_context",
      arguments: { content: log },
    })) as TextResult;
    const contextId = first.structuredContent?.contextId as string;

    const restarted = await connect({ AGENTCONTEXT_RETRIEVAL_SCOPE: "workspace" });
    try {
      const recovered = await restarted.callTool({
        name: "retrieve_context",
        arguments: { contextId },
      });
      expect(text(recovered)).toBe(log);
    } finally {
      await restarted.close();
    }

    const isolated = await connect();
    try {
      const hidden = (await isolated.callTool({
        name: "retrieve_context",
        arguments: { contextId },
      })) as TextResult;
      expect(hidden.isError).toBe(true);
    } finally {
      await isolated.close();
    }
  });
});
