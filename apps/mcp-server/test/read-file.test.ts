import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRegistrars } from "../src/index.js";
import { rawConnection, tempDir, testConfig, testRuntime } from "./helpers.js";

const log = readFileSync(
  new URL("../../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Result = {
  content: { text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function setup() {
  const { dir, remove } = tempDir();
  const project = join(dir, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "test.log"), log);
  writeFileSync(
    join(project, "src", "module.ts"),
    Array.from({ length: 60 }, (_, i) => `export const v${i + 1} = ${i + 1};`).join("\n"),
  );
  writeFileSync(join(dir, "outside.txt"), "SECRET OUTSIDE");
  const config = testConfig(dir, { files: { allowedRoots: [project], maxFileBytes: 1024 * 1024 } });
  const runtime = testRuntime(config);
  const connection = rawConnection(runtime, defaultRegistrars);
  cleanups.push(
    remove,
    () => runtime.close(),
    () => connection.close(),
  );
  await connection.initialize();
  const call = async (args: Record<string, unknown>) =>
    (
      (await connection.request("tools/call", { name: "read_file", arguments: args })) as {
        result: Result;
      }
    ).result;
  return { call, connection };
}

describe("read_file", () => {
  it("reads and optimizes a file with a recovery reference", async () => {
    const { call, connection } = await setup();
    const result = await call({ path: "test.log" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      path: "test.log",
      strategy: "log-compressor",
      recoveryAvailable: true,
    });
    expect(result.content[0]?.text).toContain("[... s1:");

    const recovered = (await connection.request("tools/call", {
      name: "retrieve_context",
      arguments: { contextId: result.structuredContent?.contextId },
    })) as { result: Result };
    expect(recovered.result.content[0]?.text).toBe(log);
  });

  it("returns a numbered line range", async () => {
    const { call } = await setup();
    const result = await call({
      path: "src/module.ts",
      startLine: 10,
      endLine: 11,
      contextLines: 1,
    });
    expect(result.structuredContent).toMatchObject({
      strategy: "code-extractor",
      path: "src/module.ts",
    });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(" 9 | export const v9 = 9;");
    expect(text).toContain("12 | export const v12 = 12;");
    expect(text).not.toContain("export const v13 = 13;");
  });

  it("rejects paths outside the allowed roots without revealing content", async () => {
    const { call } = await setup();
    for (const path of ["../outside.txt", "../../outside.txt"]) {
      const result = await call({ path });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/^PATH_NOT_ALLOWED:/);
      expect(result.content[0]?.text).not.toContain("SECRET");
    }
  });

  it("reports missing files and invalid ranges", async () => {
    const { call } = await setup();
    expect((await call({ path: "nope.txt" })).content[0]?.text).toMatch(/^NOT_FOUND:/);
    expect((await call({ path: "src/module.ts", endLine: 3 })).content[0]?.text).toMatch(
      /^INVALID_INPUT:/,
    );
  });
});
