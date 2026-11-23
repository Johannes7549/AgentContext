#!/usr/bin/env node
/**
 * Cross-platform launcher for the AgentContext MCP server, used by the plugin's
 * .mcp.json. It runs the published npm package with `npx`, which on Windows is
 * a script shim (npx.cmd) that must be started through the shell — something a
 * single .mcp.json cannot express for every operating system.
 *
 * The arguments are fixed constants (no user input reaches the shell). stdio is
 * passed through unchanged, so MCP JSON-RPC flows directly between the client
 * and the server.
 */
import { spawn } from "node:child_process";

const PACKAGE = "@agentcontext/mcp-server@0.1"; // any 0.1.x release; no shell metacharacters
const windows = process.platform === "win32";

// Run in the project directory when the client tells us where it is.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: read at runtime by Claude Code, not a Turborepo task input
const projectDir = process.env.CLAUDE_PROJECT_DIR;
const cwd = projectDir && !projectDir.includes("${") ? projectDir : process.cwd();

// Development override: run a local build (path to apps/mcp-server/dist/cli.js) instead of npm.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: read at runtime, not a Turborepo task input
const localEntry = process.env.AGENTCONTEXT_SERVER_ENTRY;

const child = localEntry
  ? spawn(process.execPath, [localEntry], {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    })
  : spawn(windows ? "npx.cmd" : "npx", ["--yes", PACKAGE], {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: windows,
      windowsHide: true,
    });

child.on("error", (error) => {
  process.stderr.write(
    `agentcontext: could not start the MCP server via npx (${error.message}). ` +
      "Install Node.js 22.13+ (which includes npx) and try again.\n",
  );
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
