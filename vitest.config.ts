import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.shared.ts";

/**
 * Root Vitest configuration (ADR-0007).
 *
 * - Unit tests: one project per workspace (`packages/*`, `apps/*`).
 * - Integration and e2e tests: root `tests/` folder.
 *
 * `pnpm test:all` runs every project from the root; `pnpm test:coverage` adds coverage.
 */
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "benchmarks/vitest.config.ts",
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/build.ts"],
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/setup/build.ts"],
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
