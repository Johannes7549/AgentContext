#!/usr/bin/env node
/**
 * AgentContext MCP server entry point (stdio).
 *
 * stdout is reserved for JSON-RPC: console.log/info are redirected to stderr
 * before anything else runs, and all logging uses the stderr logger.
 */
import { isAgentContextError } from "@agentcontext/shared";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { startStdioServer } from "./server.js";
import { defaultRegistrars } from "./tools/index.js";

console.log = console.error;
console.info = console.error;

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    const details = isAgentContextError(error) ? error.details : undefined;
    process.stderr.write(
      `agentcontext: ${error instanceof Error ? error.message : "invalid configuration"}${
        details ? `\n${JSON.stringify(details, null, 2)}` : ""
      }\n`,
    );
    process.exit(1);
  }

  const runtime = createRuntime(config);
  const handle = startStdioServer(runtime, { registrars: defaultRegistrars });
  runtime.logger.info("AgentContext MCP server started", {
    workspaceId: config.workspaceId,
    sessionId: runtime.scope.sessionId,
    commandsEnabled: config.commands.enabled,
  });

  let stopping = false;
  const shutdown = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    runtime.logger.info("AgentContext MCP server stopping", { reason });
    try {
      await handle.close();
    } catch (error) {
      runtime.logger.warn("error while closing transport", { error });
    }
    runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.stdin.on("end", () => void shutdown("stdin closed"));
  process.stdin.on("close", () => void shutdown("stdin closed"));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `agentcontext: fatal error (${error instanceof Error ? error.name : "Error"})\n`,
  );
  process.exit(1);
});
