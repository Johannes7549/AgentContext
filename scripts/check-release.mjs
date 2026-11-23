#!/usr/bin/env node
/**
 * Verify that every published package has the expected version, that release
 * notes and a changelog entry exist for it, and that nothing published is
 * marked private.
 *
 *   node scripts/check-release.mjs 0.1.0
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLISHED = [
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
const expected = process.argv[2];
const problems = [];

if (!expected) {
  process.stderr.write("usage: node scripts/check-release.mjs <version>\n");
  process.exit(1);
}
for (const dir of PUBLISHED) {
  const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  if (pkg.version !== expected)
    problems.push(`${pkg.name} has version ${pkg.version}, expected ${expected}`);
  if (pkg.private) problems.push(`${pkg.name} is private`);
  for (const file of ["LICENSE", "README.md"]) {
    if (!existsSync(join(root, dir, file))) problems.push(`${pkg.name} is missing ${file}`);
  }
}
const plugin = JSON.parse(
  readFileSync(join(root, "plugins/agentcontext/.claude-plugin/plugin.json"), "utf8"),
);
if (plugin.version !== expected) problems.push(`plugin.json has version ${plugin.version}`);
const marketplace = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
for (const entry of marketplace.plugins) {
  if (entry.version !== expected)
    problems.push(`marketplace entry ${entry.name} has version ${entry.version}`);
}
const skill = readFileSync(join(root, "plugins/agentcontext/skills/agentcontext/SKILL.md"), "utf8");
if (!skill.includes(`version: "${expected}"`))
  problems.push("SKILL.md metadata version does not match");
if (!existsSync(join(root, "docs", "releases", `v${expected}.md`))) {
  problems.push(`missing release notes docs/releases/v${expected}.md`);
}
if (!readFileSync(join(root, "CHANGELOG.md"), "utf8").includes(`## [${expected}]`)) {
  problems.push(`CHANGELOG.md has no entry for ${expected}`);
}

if (problems.length) {
  process.stderr.write(`${problems.map((p) => `- ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stderr.write(`release ${expected} is consistent\n`);
