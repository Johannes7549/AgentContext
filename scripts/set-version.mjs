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

// Claude Code plugin and its marketplace entry move with the packages.
const pluginFile = join(root, "plugins/agentcontext/.claude-plugin/plugin.json");
const plugin = JSON.parse(readFileSync(pluginFile, "utf8"));
plugin.version = version;
writeFileSync(pluginFile, `${JSON.stringify(plugin, null, 2)}\n`);

const marketplaceFile = join(root, ".claude-plugin/marketplace.json");
const marketplace = JSON.parse(readFileSync(marketplaceFile, "utf8"));
for (const entry of marketplace.plugins) if (entry.name === plugin.name) entry.version = version;
writeFileSync(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`);

// Skill metadata version (frontmatter `metadata.version`).
const skillFile = join(root, "plugins/agentcontext/skills/agentcontext/SKILL.md");
const skill = readFileSync(skillFile, "utf8");
writeFileSync(skillFile, skill.replace(/^(\s+version: )"[^"]*"/m, `$1"${version}"`));

// apps/mcp-server reads its version from its package.json at runtime.
process.stderr.write(
  `set version ${version} on ${PUBLISHED.length} packages, the plugin and the skill\n`,
);
