import { readFileSync } from "node:fs";

/** Reported to MCP clients during initialization. */
export const SERVER_NAME = "agentcontext";

/** Read from this package's package.json so the reported version can never drift from the published one. */
export const SERVER_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
