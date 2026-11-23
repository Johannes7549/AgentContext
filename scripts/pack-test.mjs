#!/usr/bin/env node
/**
 * Release check: pack every published package, verify the tarball contents,
 * install the tarballs into an empty project with npm, and run the installed
 * MCP server and TypeScript API end to end. Requires a prior `pnpm build`.
 *
 *   node scripts/pack-test.mjs
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
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
const work = mkdtempSync(join(tmpdir(), "agentcontext-pack-"));
const packs = join(work, "packs");
const project = join(work, "project");
mkdirSync(packs);
mkdirSync(project);
/** Minimal .tgz (ustar) reader: file path -> UTF-8 content. Avoids platform tar differences. */
function readTarball(path) {
  const data = gunzipSync(readFileSync(path));
  const entries = new Map();
  for (let offset = 0; offset + 512 <= data.length; ) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
    };
    const name = field(0, 100);
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === "0" || type === "")
      entries.set(prefix ? `${prefix}/${name}` : name, body.toString("utf8"));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

const log = (message) => process.stderr.write(`${message}\n`);
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

try {
  // 1. Pack (pnpm rewrites workspace:* to real versions).
  for (const dir of PUBLISHED) {
    execSync(`pnpm pack --pack-destination "${packs}"`, {
      cwd: join(root, dir),
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  const tarballs = readdirSync(packs).filter((f) => f.endsWith(".tgz"));
  check(
    tarballs.length === PUBLISHED.length,
    `packed ${tarballs.length}/${PUBLISHED.length} packages`,
  );

  // 2. Inspect contents.
  for (const tarball of tarballs) {
    const entries = readTarball(join(packs, tarball));
    const files = [...entries.keys()];
    const bad = files.filter(
      (f) =>
        f.endsWith(".tsbuildinfo") ||
        f.endsWith(".map") ||
        /\/(src|test|node_modules)\//.test(f) ||
        /\.(db|log|env)$/.test(f),
    );
    check(
      bad.length === 0,
      `${tarball}: no source, tests, maps, build info or data (${files.length} files)`,
    );
    check(
      files.includes("package/LICENSE") && files.includes("package/README.md"),
      `${tarball}: LICENSE and README`,
    );
    const manifest = JSON.parse(entries.get("package/package.json") ?? "{}");
    const deps = JSON.stringify(manifest.dependencies ?? {});
    check(!deps.includes("workspace:"), `${tarball}: no workspace: dependency specifiers`);
  }

  // 3. Install into an empty project from the tarballs only.
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "pack-test", private: true, type: "module" }),
  );
  const args = tarballs.map((t) => `"${join(packs, t)}"`).join(" ");
  execSync(`npm install --no-audit --no-fund --loglevel=error ${args}`, {
    cwd: project,
    stdio: ["ignore", "ignore", "inherit"],
  });
  check(true, "npm install from tarballs");

  // 4. TypeScript/JavaScript API from the installed packages.
  writeFileSync(
    join(project, "api.mjs"),
    `import { createEngine } from "@agentcontext/core";
import { logCompressor } from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
const engine = createEngine({ tokenizer: new FallbackEstimator(), strategies: [logCompressor] });
const log = Array.from({ length: 300 }, () => "2026-01-01T00:00:00Z INFO same").join("\\n");
const r = await engine.optimize({ content: log, source: "pack-test" }, { allowLossy: true });
console.log(r.strategy);`,
  );
  const api = execSync(`node api.mjs`, { cwd: project, encoding: "utf8" }).trim();
  check(api === "log-compressor", `installed API works (strategy ${api})`);

  // 5. Installed MCP server over stdio.
  const cli = join(project, "node_modules", "@agentcontext", "mcp-server", "dist", "cli.js");
  const response = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli], {
      cwd: project,
      env: { ...process.env, AGENTCONTEXT_STORAGE_DIR: join(work, "store") },
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("server did not respond"));
    }, 20_000);
    let messages;
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const lines = out.split("\n").filter(Boolean);
      if (lines.length >= 2 && !messages) {
        messages = lines.map((l) => JSON.parse(l));
        child.stdin.end(); // graceful shutdown; wait for exit so Windows releases file locks
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (messages) resolve(messages);
      else reject(new Error("server exited without responding"));
    });
    child.on("error", reject);
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pack-test", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
  const version = JSON.parse(
    readFileSync(join(project, "node_modules/@agentcontext/mcp-server/package.json"), "utf8"),
  ).version;
  check(
    response[0]?.result?.serverInfo?.version === version,
    `installed server reports version ${version}`,
  );
  const tools = response[1]?.result?.tools?.map((t) => t.name) ?? [];
  check(
    tools.includes("optimize_context") && tools.includes("retrieve_context"),
    `installed server lists tools (${tools.join(", ")})`,
  );
} catch (error) {
  failures.push(String(error?.message ?? error));
  log(`FAIL ${error?.message ?? error}`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

if (failures.length) {
  log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
log("\nall pack checks passed");
