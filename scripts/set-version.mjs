#!/usr/bin/env node
/**
 * Set one version on every published package (fixed versioning) and the root
 * package. The MCP server reports the version from its own package.json.
 *
 *   node scripts/set-version.mjs 0.1.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHED = [
  "packages/shared",
  "packages/tokenization",
  "packages/strategies",
  "packages/storage",
  "packages/retrieval",
  "packages/observability",
  "packages/core",
  "apps/mcp-server",
];

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  process.stderr.write("usage: node scripts/set-version.mjs <semver>\n");
  process.exit(1);
}

for (const dir of [".", ...PUBLISHED]) {
  const file = join(root, dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

// apps/mcp-server reads its version from its package.json at runtime.
process.stderr.write(`set version ${version} on ${PUBLISHED.length} packages\n`);
