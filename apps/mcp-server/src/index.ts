/**
 * @agentcontext/mcp-server — AgentContext MCP server over stdio. The only
 * workspace that imports the MCP SDK (ADR-0001).
 */
export const packageName = "@agentcontext/mcp-server" as const;

export {
  ConfigSchema,
  type ConfigSources,
  defaultConfig,
  defaultStorageDir,
  loadConfig,
  type ServerConfig,
} from "./config.js";
export {
  CLEANUP_INTERVAL_MS,
  createRuntime,
  type Runtime,
  type RuntimeOptions,
} from "./runtime.js";
export { createServer, type Registrar, type StartOptions, startStdioServer } from "./server.js";
export { defaultRegistrars } from "./tools/index.js";
export { SERVER_NAME, SERVER_VERSION } from "./version.js";
