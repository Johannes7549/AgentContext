import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Vitest global setup for integration and e2e tests: make sure every workspace
 * is built, because some tests spawn the real MCP server (apps/mcp-server/dist).
 * Turborepo caching makes this nearly free when nothing changed.
 */
export default function setup(): void {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  execSync("pnpm exec turbo run build --output-logs=errors-only", {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
