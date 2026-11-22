import { isAgentContextError } from "@agentcontext/shared";
import type { Runtime } from "../runtime.js";

/** Tool result shape (MCP CallToolResult subset used by AgentContext). */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Tool error as an `isError` result (not a protocol error). Messages carry a
 * code and never raw content; unexpected errors are reported generically and
 * logged by name only.
 */
export function toolError(error: unknown, runtime: Runtime, tool: string): ToolResult {
  if (isAgentContextError(error)) {
    const details = error.details?.issues ? `\n${JSON.stringify(error.details.issues)}` : "";
    return errorResult(error.code, `${error.message}${details}`);
  }
  runtime.logger.error("tool failed unexpectedly", { tool, error });
  return errorResult("INTERNAL", "Internal error while running the tool");
}

export function errorResult(code: string, message: string): ToolResult {
  return { content: [{ type: "text", text: `${code}: ${message}` }], isError: true };
}
