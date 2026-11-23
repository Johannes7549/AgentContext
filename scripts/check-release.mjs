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
