/**
 * @agentcontext/mcp-server — AgentContext MCP server over stdio. The only
 * workspace that imports the MCP SDK (ADR-0001).
 */
export const packageName = "@agentcontext/mcp-server" as const;

export {
  CommandAdapter,
  type CommandAdapterOptions,
  type CommandRequest,
  type CommandResult,
  filterEnv,
} from "./adapters/command-adapter.js";
export {
  contentTypeFor,
  FileAdapter,
  type FileAdapterOptions,
  type FileReadResult,
} from "./adapters/file-adapter.js";
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
export {
  collectStats,
  commandTranscript,
  defaultRegistrars,
  EXECUTE_COMMAND_DESCRIPTION,
  formatOptimizeResult,
  formatRetrieveResult,
  formatStats,
  GUIDELINES,
  OPTIMIZE_CONTEXT_DESCRIPTION,
  READ_FILE_DESCRIPTION,
  RETRIEVE_CONTEXT_DESCRIPTION,
  STATS_DESCRIPTION,
} from "./tools/index.js";
export { SERVER_NAME, SERVER_VERSION } from "./version.js";
