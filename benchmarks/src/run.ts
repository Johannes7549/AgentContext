/**
 * Benchmark CLI: `pnpm bench` (after `pnpm build`).
 * Options: --iterations N (default 10), --out DIR (default benchmarks/reports).
 * Writes latest.json and latest.md; exits 1 if any v0.1 target is missed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarks, toMarkdown } from "./runner.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const iterations = Number(arg("--iterations") ?? 10);
const out = resolve(arg("--out") ?? fileURLToPath(new URL("../reports/", import.meta.url)));

const report = await runBenchmarks({ iterations });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(out, "latest.md"), toMarkdown(report));

for (const t of report.targets) {
  process.stderr.write(`${t.met ? "PASS" : "FAIL"}  ${t.name}: ${t.actual} (target ${t.target})\n`);
}
process.stderr.write(`report written to ${out}\n`);
if (report.targets.some((t) => !t.met)) process.exitCode = 1;
