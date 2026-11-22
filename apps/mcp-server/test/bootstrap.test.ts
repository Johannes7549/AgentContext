import { writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultStorageDir, loadConfig, SERVER_NAME, SERVER_VERSION } from "../src/index.js";
import { rawConnection, tempDir, testConfig, testRuntime } from "./helpers.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    const config = loadConfig({
      env: {},
      argv: [],
      cwd: "/work/project",
      platform: "linux",
      home: "/home/u",
    });
    expect(config).toMatchObject({
      retrievalScope: "session",
      ttlHours: 168,
      quotaMb: 500,
      storageFailurePolicy: "return_original",
      logLevel: "info",
      commands: { enabled: false, allowlist: [] },
    });
    expect(config.files.allowedRoots).toEqual([resolve("/work/project")]);
    expect(config.workspaceId).toMatch(/^ws_[0-9a-f]{16}$/);
    expect(loadConfig({ env: {}, argv: [], cwd: "/other" }).workspaceId).not.toBe(
      config.workspaceId,
    );
  });

  it.each([
    [
      "win32",
      { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
      join("C:\\Users\\u\\AppData\\Local", "agentcontext"),
    ],
    ["darwin", {}, join("/Users/u", "Library", "Application Support", "agentcontext")],
    ["linux", { XDG_DATA_HOME: "/data" }, join("/data", "agentcontext")],
    ["linux", {}, join("/Users/u", ".local", "share", "agentcontext")],
  ] as const)("picks the %s storage directory", (platform, env, expected) => {
    expect(defaultStorageDir(env, platform, "/Users/u")).toBe(expected);
  });

  it("merges file then environment, with environment winning", () => {
    const { dir, remove } = tempDir();
    cleanups.push(remove);
    const file = join(dir, "agentcontext.json");
    writeFileSync(
      file,
      JSON.stringify({
        ttlHours: 24,
        logLevel: "debug",
        commands: { enabled: true, allowlist: ["git"] },
      }),
    );
    const config = loadConfig({
      env: {
        AGENTCONTEXT_LOG_LEVEL: "warn",
        AGENTCONTEXT_STORAGE_DIR: "store",
        AGENTCONTEXT_ALLOWED_ROOTS: ["a", "b"].join(delimiter),
        AGENTCONTEXT_COMMAND_ALLOWLIST: "git, pnpm",
      },
      argv: ["--config", file],
      cwd: dir,
    });
    expect(config.ttlHours).toBe(24);
    expect(config.logLevel).toBe("warn");
    expect(config.storageDir).toBe(join(dir, "store"));
    expect(config.files.allowedRoots).toEqual([join(dir, "a"), join(dir, "b")]);
    expect(config.commands).toMatchObject({
      enabled: true,
      allowlist: ["git", "pnpm"],
      timeoutMs: 30_000,
    });
  });

  it.each([
    [{ AGENTCONTEXT_RETRIEVAL_SCOPE: "global" }, "retrievalScope"],
    [{ AGENTCONTEXT_TTL_HOURS: "-1" }, "ttlHours"],
    [{ AGENTCONTEXT_LOG_LEVEL: "verbose" }, "logLevel"],
  ])("rejects invalid environment values %j", (env, path) => {
    try {
      loadConfig({ env, argv: [], cwd: "/w" });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_INPUT" });
      expect(JSON.stringify((error as { details: unknown }).details)).toContain(path);
    }
  });

  it("rejects unknown keys and unreadable files", () => {
    const { dir, remove } = tempDir();
    cleanups.push(remove);
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ telemetry: true }));
    expect(() => loadConfig({ env: {}, argv: [`--config=${file}`], cwd: dir })).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() =>
      loadConfig({ env: { AGENTCONTEXT_CONFIG: join(dir, "missing.json") }, argv: [], cwd: dir }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("runtime and stdio server", () => {
  it("creates storage in the configured directory with a server-owned scope", () => {
    const { dir, remove } = tempDir();
    const runtime = testRuntime(
      testConfig(dir, { workspaceId: "ws_test", retrievalScope: "workspace" }),
    );
    cleanups.push(remove, () => runtime.close());
    expect(runtime.scope).toEqual({
      workspaceId: "ws_test",
      sessionId: "sess-test",
      mode: "workspace",
    });
    expect(runtime.storage.directory).toBe(join(dir, "store"));
    expect(runtime.tokenizer.isExact).toBe(false);
  });

  it("completes the MCP handshake over stdio and writes only JSON-RPC to stdout", async () => {
    const { dir, remove } = tempDir();
    const runtime = testRuntime(testConfig(dir));
    const connection = rawConnection(runtime);
    cleanups.push(
      remove,
      () => runtime.close(),
      () => connection.close(),
    );

    const response = await connection.initialize();
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      result: { serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } },
    });
    const pong = await connection.request("ping");
    expect(pong).toMatchObject({ result: {} });
    for (const line of connection.outputLines) {
      expect(JSON.parse(line)).toHaveProperty("jsonrpc", "2.0");
    }
  });

  it("closes idempotently", () => {
    const { dir, remove } = tempDir();
    const runtime = testRuntime(testConfig(dir));
    cleanups.push(remove);
    runtime.close();
    expect(() => runtime.close()).not.toThrow();
  });
});
