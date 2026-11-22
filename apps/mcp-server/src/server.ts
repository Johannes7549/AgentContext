import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/server";
import {
  type StdioServerHandle,
  StdioServerTransport,
  serveStdio,
} from "@modelcontextprotocol/server/stdio";
import type { Runtime } from "./runtime.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

/** Hook used by later tasks to register tools, resources and prompts. */
export type Registrar = (server: McpServer, runtime: Runtime) => void;

/**
 * Build one McpServer instance for a connection. Only this app imports the MCP
 * SDK (ADR-0001); everything else goes through `runtime`.
 */
export function createServer(runtime: Runtime, registrars: readonly Registrar[] = []): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const register of registrars) register(server, runtime);
  return server;
}

export interface StartOptions {
  registrars?: readonly Registrar[];
  /** Custom streams (tests); defaults to process stdin/stdout. */
  stdin?: Readable;
  stdout?: Writable;
}

/** Serve MCP over stdio. stdout carries only JSON-RPC; logs go to stderr. */
export function startStdioServer(runtime: Runtime, options: StartOptions = {}): StdioServerHandle {
  const transport =
    options.stdin || options.stdout
      ? new StdioServerTransport(options.stdin, options.stdout)
      : undefined;
  return serveStdio(() => createServer(runtime, options.registrars ?? []), {
    ...(transport ? { transport } : {}),
    onerror: (error) => runtime.logger.warn("transport error", { error }),
  });
}
