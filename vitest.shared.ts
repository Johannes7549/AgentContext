import { fileURLToPath } from "node:url";

/**
 * Shared Vitest settings (ADR-0007).
 *
 * Workspace packages are aliased to their TypeScript sources so tests never
 * depend on a prior build and always exercise the current code.
 */

const root = fileURLToPath(new URL(".", import.meta.url));

const workspaces: Record<string, string> = {
  "@agentcontext/shared": "packages/shared",
  "@agentcontext/tokenization": "packages/tokenization",
  "@agentcontext/strategies": "packages/strategies",
  "@agentcontext/storage": "packages/storage",
  "@agentcontext/retrieval": "packages/retrieval",
  "@agentcontext/observability": "packages/observability",
  "@agentcontext/core": "packages/core",
  "@agentcontext/mcp-server": "apps/mcp-server",
};

export const workspaceAliases: Record<string, string> = Object.fromEntries(
  Object.entries(workspaces).map(([name, dir]) => [name, `${root}${dir}/src/index.ts`]),
);

/** Unit-test project for one workspace package (tests live in `<pkg>/test`). */
export function unitProject(name: string) {
  return {
    resolve: { alias: workspaceAliases },
    test: {
      name,
      include: ["test/**/*.test.ts"],
      environment: "node" as const,
    },
  };
}
