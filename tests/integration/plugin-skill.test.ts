import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompressionOptionsSchema, RetrievalSelectorSchema } from "@agentcontext/shared";
import { afterAll, describe, expect, it } from "vitest";
import { defaultRegistrars } from "../../apps/mcp-server/src/index.js";
import {
  rawConnection,
  tempDir,
  testConfig,
  testRuntime,
} from "../../apps/mcp-server/test/helpers.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const pluginDir = join(root, "plugins", "agentcontext");
const skillDir = join(pluginDir, "skills", "agentcontext");
const read = (path: string) => readFileSync(path, "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;

const skillFiles = [
  join(skillDir, "SKILL.md"),
  ...readdirSync(join(skillDir, "references")).map((f) => join(skillDir, "references", f)),
];

/** Minimal frontmatter reader for the flat key/value (+ one nested map) structure used here. */
function frontmatter(markdown: string): {
  data: Record<string, string>;
  keys: string[];
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error("missing frontmatter");
  const data: Record<string, string> = {};
  const keys: string[] = [];
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      keys.push(top[1] as string);
      data[top[1] as string] = (top[2] as string).trim();
    }
  }
  return { data, keys, body: match[2] as string };
}

const cleanups: (() => unknown)[] = [];
afterAll(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serverToolNames(): Promise<string[]> {
  const { dir, remove } = tempDir();
  const base = testConfig(dir);
  const runtime = testRuntime({
    ...base,
    commands: { ...base.commands, enabled: true, allowlist: ["git"] },
  });
  const connection = rawConnection(runtime, defaultRegistrars);
  cleanups.push(
    remove,
    () => runtime.close(),
    () => connection.close(),
  );
  await connection.initialize();
  const response = (await connection.request("tools/list")) as {
    result: { tools: { name: string }[] };
  };
  return response.result.tools.map((t) => t.name);
}

describe("agentcontext skill (portable Agent Skills format)", () => {
  const { data, keys, body } = frontmatter(read(join(skillDir, "SKILL.md")));

  it("uses only open-spec frontmatter fields with valid name and description", () => {
    const allowed = [
      "name",
      "description",
      "license",
      "compatibility",
      "metadata",
      "allowed-tools",
    ];
    expect(
      keys.every((k) => allowed.includes(k)),
      `keys: ${keys.join(", ")}`,
    ).toBe(true);
    expect(data.name).toBe("agentcontext");
    expect(data.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(data.name).toBe(skillDir.split(/[\\/]/).pop());
    expect((data.description ?? "").length).toBeGreaterThan(50);
    expect((data.description ?? "").length).toBeLessThanOrEqual(1024);
    expect((data.compatibility ?? "").length).toBeLessThanOrEqual(500);
  });

  it("keeps SKILL.md short (progressive disclosure)", () => {
    expect(body.split("\n").length).toBeLessThan(500);
  });

  it("mentions only tools the server actually provides", async () => {
    const tools = await serverToolNames();
    for (const file of skillFiles) {
      const mentioned = new Set(
        [...read(file).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)]
          .map((m) => m[1] as string)
          .filter((name) => /context|file|command|stats/.test(name)),
      );
      for (const name of mentioned) expect(tools, `${file}: ${name}`).toContain(name);
    }
  });

  it("uses only valid options and selectors in every JSON example", () => {
    let checked = 0;
    for (const file of skillFiles) {
      const text = read(file);
      for (const block of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
        const example = JSON.parse(block[1] as string) as Record<string, unknown>;
        if (example.options !== undefined) {
          expect(
            CompressionOptionsSchema.safeParse(example.options).success,
            `${file}: options`,
          ).toBe(true);
        }
        if (example.selector !== undefined) {
          expect(
            RetrievalSelectorSchema.safeParse(example.selector).success,
            `${file}: selector`,
          ).toBe(true);
        }
        checked++;
      }
      for (const inline of text.matchAll(/`(\{"type": "[a-z_]+", "value": "[^`]*"\})`/g)) {
        expect(
          RetrievalSelectorSchema.safeParse(JSON.parse(inline[1] as string)).success,
          inline[1],
        ).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("has no broken relative links", () => {
    for (const file of skillFiles) {
      for (const link of read(file).matchAll(/\]\(([^)#\s]+)\)/g)) {
        const target = link[1] as string;
        if (/^https?:/.test(target)) continue;
        expect(existsSync(join(dirname(file), target)), `${file} -> ${target}`).toBe(true);
      }
    }
  });
});

describe("agentcontext Claude Code plugin and marketplace", () => {
  type Plugin = { name: string; version: string; license: string };
  type Marketplace = {
    name: string;
    owner: { name: string };
    plugins: { name: string; source: string; version: string }[];
  };
  type McpConfig = {
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };

  const plugin = json<Plugin>(join(pluginDir, ".claude-plugin", "plugin.json"));
  const marketplace = json<Marketplace>(join(root, ".claude-plugin", "marketplace.json"));
  const serverVersion = json<{ version: string }>(
    join(root, "apps", "mcp-server", "package.json"),
  ).version;

  it("marketplace entry points at the plugin and matches its name and version", () => {
    const entry = marketplace.plugins.find((p) => p.name === plugin.name);
    expect(entry).toBeDefined();
    expect(entry?.source).toBe("./plugins/agentcontext");
    expect(existsSync(join(root, entry?.source ?? ""))).toBe(true);
    expect(entry?.version).toBe(plugin.version);
  });

  it("is versioned with the MCP server and licensed like the project", () => {
    expect(plugin.version).toBe(serverVersion);
    expect(plugin.license).toBe("Apache-2.0");
  });

  it("starts the server through the bundled cross-platform launcher", () => {
    const server = json<McpConfig>(join(pluginDir, ".mcp.json")).mcpServers.agentcontext;
    expect(server?.command).toBe("node");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder substituted by Claude Code
    expect(server?.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/scripts/launch.mjs"]);
    const launcher = read(join(pluginDir, "scripts", "launch.mjs"));
    const [major, minor] = serverVersion.split(".");
    expect(launcher).toContain(`"@agentcontext/mcp-server@${major}.${minor}"`);
    expect(launcher).toContain("shell: windows");
  });
});
