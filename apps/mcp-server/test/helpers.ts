import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { silentLogger } from "@agentcontext/observability";
import { defaultConfig, type ServerConfig } from "../src/config.js";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { type Registrar, startStdioServer } from "../src/server.js";

export function tempDir(prefix = "agentcontext-mcp-"): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function testConfig(dir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = defaultConfig({ cwd: dir });
  return { ...base, storageDir: join(dir, "store"), ...overrides };
}

export function testRuntime(config: ServerConfig, sessionId = "sess-test"): Runtime {
  return createRuntime(config, { sessionId, logger: silentLogger, periodicCleanup: false });
}

/** Minimal JSON-RPC client over in-memory streams (no SDK) for protocol-level tests. */
export function rawConnection(runtime: Runtime, registrars: readonly Registrar[] = []) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const handle = startStdioServer(runtime, { stdin, stdout, registrars });
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const outputLines: string[] = [];
  let buffer = "";
  stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      outputLines.push(line);
      const message = JSON.parse(line) as Record<string, unknown>;
      const resolve = typeof message.id === "number" ? pending.get(message.id) : undefined;
      resolve?.(message);
      newline = buffer.indexOf("\n");
    }
  });
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method: string, params: Record<string, unknown> = {}) =>
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const initialize = async () => {
    const response = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    notify("notifications/initialized");
    return response;
  };
  return { request, notify, initialize, outputLines, close: () => handle.close() };
}
