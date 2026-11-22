import { afterEach, describe, expect, it } from "vitest";
import { defaultRegistrars } from "../src/index.js";
import { rawConnection, tempDir, testConfig, testRuntime } from "./helpers.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Result = {
  content: { text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function connect(enabled: boolean) {
  const { dir, remove } = tempDir();
  const base = testConfig(dir);
  const runtime = testRuntime({
    ...base,
    commands: { ...base.commands, enabled, allowlist: [process.execPath], timeoutMs: 10_000 },
  });
  const connection = rawConnection(runtime, defaultRegistrars);
  cleanups.push(
    remove,
    () => runtime.close(),
    () => connection.close(),
  );
  await connection.initialize();
  const tools = (await connection.request("tools/list")) as {
    result: { tools: { name: string }[] };
  };
  const call = async (args: Record<string, unknown>) =>
    (
      (await connection.request("tools/call", { name: "execute_command", arguments: args })) as {
        result: Result;
      }
    ).result;
  return { names: tools.result.tools.map((t) => t.name), call, connection };
}

describe("execute_command", () => {
  it("is not registered unless commands are enabled", async () => {
    const { names } = await connect(false);
    expect(names).not.toContain("execute_command");
  });

  it("runs an allowlisted command and returns optimized, recoverable output", async () => {
    const { names, call, connection } = await connect(true);
    expect(names).toContain("execute_command");
    const script =
      "for (let i = 0; i < 300; i++) console.log('2026-11-23T10:00:00Z INFO poll ok'); console.error('ERROR boom'); process.exit(2)";
    const result = await call({ command: process.execPath, args: ["-e", script] });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toMatch(/^\[node(\.exe)?: exit 2, \d+ ms\]/);
    expect(result.content[0]?.text).toContain("ERROR boom");
    expect(result.structuredContent).toMatchObject({
      exitCode: 2,
      timedOut: false,
      outputTruncated: false,
      strategy: "log-compressor",
      recoveryAvailable: true,
    });
    const full = (await connection.request("tools/call", {
      name: "retrieve_context",
      arguments: { contextId: result.structuredContent?.contextId },
    })) as { result: Result };
    expect(full.result.content[0]?.text).toContain("--- stderr ---\nERROR boom");
  });

  it("returns isError for commands that are not allowlisted", async () => {
    const { call } = await connect(true);
    const result = await call({ command: "git", args: ["status"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/^COMMAND_NOT_ALLOWED:/);
  });
});
