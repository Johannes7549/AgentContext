/**
 * Deterministic benchmark dataset generator. All data is synthetic (no real
 * people, secrets or systems). Run with `pnpm --filter @agentcontext/benchmarks generate`
 * after a build; output is committed under benchmarks/datasets/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATASETS_DIR, type Scenario } from "./scenario.js";

/** mulberry32 — small seeded PRNG so datasets are byte-for-byte reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const time = (s: number) => `2026-11-23T10:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}Z`;

export function terminalLarge(): string {
  const rand = prng(1);
  const lines = ["> app@1.0.0 test", "> vitest run", "", " RUN  v5.1.1 /work/app", ""];
  let s = 0;
  for (let file = 1; file <= 120; file++) {
    for (let k = 0; k < 6; k++) lines.push(`${time(s++)} INFO [db] pool size=10 idle=8`);
    lines.push(`${time(s++)} INFO [http] GET /health 200 2ms`);
    if (file % 3 === 0) {
      lines.push("(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.");
    }
    if (file % 10 === 0)
      lines.push(`${time(s++)} WARN [cache] eviction rate high: ${(rand() * 10).toFixed(1)}%`);
    const tests = 5 + Math.floor(rand() * 10);
    lines.push(
      ` ✓ src/module${pad(file, 3)}.test.ts (${tests} tests) ${10 + Math.floor(rand() * 90)}ms`,
    );
    if (file === 64)
      lines.push(`${time(s++)} INFO [perf] slowest test: src/report/export.test.ts 4200ms`);
    if (file === 77) {
      lines.push(" FAIL  src/billing/invoice.test.ts > computes totals with tax");
      lines.push("AssertionError: expected 118.5 to be 118.05 // Object.is equality");
      lines.push("    at src/billing/invoice.test.ts:42:19");
    }
    if (file === 103) {
      lines.push(" FAIL  src/auth/session.test.ts > refreshes expired tokens");
      lines.push("TypeError: Cannot read properties of undefined (reading 'expiresAt')");
      lines.push("    at refresh (src/auth/session.ts:88:23)");
      lines.push("    at src/auth/session.test.ts:57:11");
    }
  }
  lines.push(
    "",
    " Test Files  2 failed | 118 passed (120)",
    "      Tests  2 failed | 940 passed (942)",
    "",
  );
  return lines.join("\n");
}

export function apiResponses(): string {
  const rand = prng(2);
  const first = [
    "Ada",
    "Alan",
    "Grace",
    "Linus",
    "Barbara",
    "Edsger",
    "Margaret",
    "Dennis",
    "Frances",
    "Ken",
  ];
  const last = ["Example", "Sample", "Test", "Demo", "Placeholder"];
  const plans = ["free", "pro", "team", "enterprise"];
  const cities = ["Springfield", "Riverton", "Lakeside", "Hillview", "Brookfield"];
  const data = Array.from({ length: 200 }, (_, i) => {
    const n = i + 1;
    return {
      id: `cus_${pad(n, 4)}`,
      name: `${first[n % first.length]} ${last[n % last.length]}`,
      email: `user${pad(n, 4)}@example.com`,
      plan: plans[Math.floor(rand() * plans.length)],
      created_at: `2025-${pad(1 + (n % 12))}-${pad(1 + (n % 28))}T08:00:00Z`,
      address: {
        line1: `${n} Example Street`,
        city: cities[n % cities.length],
        postcode: `EX${n % 9} ${n % 7}AB`,
      },
      preferences: {
        newsletter: n % 2 === 0,
        theme: n % 3 === 0 ? "dark" : "light",
        locale: "en-GB",
      },
      metadata: {
        source: "import",
        score: Math.round(rand() * 1000) / 10,
        tags: ["synthetic", `cohort-${n % 5}`],
      },
    };
  });
  return `${JSON.stringify(
    {
      data,
      meta: { total: 200, page: 1, per_page: 200, request_id: "req_7f3a9c" },
      debug: { timing_ms: { db: 41, serialize: 9 }, server: "api-3", cache: "miss" },
    },
    null,
    2,
  )}\n`;
}

const BOILERPLATE = [
  "This report was generated automatically by the monitoring system. Do not reply to this message; contact the on-call engineer through the incident channel instead.",
  "Confidentiality notice: this document is intended for internal operational use only and may contain information that has not been reviewed for external distribution.",
  "Reminder: follow the runbook steps in order and record every action taken in the incident timeline before moving to the next step.",
];

export function duplicateHeavy(): string {
  const events = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    return `Event ${n}: at ${time(n * 97)} the ${["api", "worker", "scheduler", "gateway"][n % 4]} service reported ${
      ["elevated latency", "a failed deploy", "a disk usage alert", "a certificate warning"][n % 4]
    } affecting ${n * 3} percent of requests in region eu-${["west", "north", "central"][n % 3]}.`;
  });
  const paragraphs: string[] = ["# Weekly incident digest"];
  for (const [i, event] of events.entries()) {
    paragraphs.push(event, BOILERPLATE[0] as string);
    if (i % 2 === 0) paragraphs.push(BOILERPLATE[1] as string);
    if (i % 3 === 0) paragraphs.push(BOILERPLATE[2] as string);
  }
  for (let k = 0; k < 12; k++) paragraphs.push(BOILERPLATE[0] as string);
  return `${paragraphs.join("\n\n")}\n`;
}

export function documentation(): string {
  const rand = prng(4);
  const words =
    "agent context storage retrieval strategy budget token segment marker workspace session configuration server client tool output recovery".split(
      " ",
    );
  const sentence = () => {
    const n = 10 + Math.floor(rand() * 10);
    const ws = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]);
    return `${ws.join(" ").replace(/^./, (c) => c.toUpperCase())}.`;
  };
  const paragraph = () => Array.from({ length: 4 }, sentence).join(" ");
  const sections: [string, string[]][] = [
    ["Overview", [paragraph(), paragraph()]],
    [
      "Requirements",
      [
        paragraph(),
        "The minimum supported Node version is 22.13; older versions lack node:sqlite.",
        paragraph(),
      ],
    ],
    ["Installation", [paragraph(), "```sh\nnpm install --global @example/tool\n```", paragraph()]],
    [
      "Configuration",
      [
        paragraph(),
        "The default port is 7341 and can be changed with the PORT environment variable.",
        paragraph(),
      ],
    ],
    ["Architecture", [paragraph(), paragraph(), paragraph()]],
  ];
  for (let k = 1; k <= 20; k++)
    sections.push([`Reference topic ${k}`, [paragraph(), paragraph(), paragraph()]]);
  sections.push([
    "Troubleshooting",
    [
      paragraph(),
      "If startup fails with EACCES, run `tool doctor --fix-permissions` and restart the service.",
      paragraph(),
    ],
  ]);
  sections.push(["Changelog", [paragraph(), paragraph()]]);
  const body = sections
    .map(([title, paras]) => `## ${title}\n\n${paras.join("\n\n")}`)
    .join("\n\n");
  return `# Example Tool Handbook\n\n${paragraph()}\n\n${body}\n`;
}

export function sourceCode(): { code: string; start: number; end: number } {
  const lines: string[] = ['import { round } from "./math.js";', ""];
  let start = 0;
  let end = 0;
  for (let i = 1; i <= 60; i++) {
    lines.push(
      `/** Helper ${i}: synthetic utility used by the benchmark. */`,
      `export function helper${i}(values: number[]): number {`,
      "  let total = 0;",
      "  for (const value of values) {",
      `    total += value * ${i};`,
      "  }",
      `  return round(total / ${i + 1});`,
      "}",
      "",
    );
    if (i === 41) {
      start = lines.length + 1;
      lines.push(
        "/** Computes an invoice total including tax and discounts. */",
        "export function calculateInvoiceTotal(lines: { price: number; quantity: number }[], rate: number, discount = 0): number {",
        "  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);",
        "  const discounted = subtotal - discount;",
        "  const tax = discounted * rate;",
        "  return round(discounted + tax);",
        "}",
      );
      end = lines.length;
      lines.push("");
    }
  }
  return { code: `${lines.join("\n")}\n`, start, end };
}

export function sourceDiff(): string {
  const out: string[] = [];
  const files = [
    "src/billing/invoice.ts",
    "src/billing/tax.ts",
    "src/auth/session.ts",
    "src/api/routes.ts",
  ];
  for (const [f, file] of files.entries()) {
    const context = (k: number) => `   const value${f}_${k} = compute(${k});`;
    out.push(
      `diff --git a/${file} b/${file}`,
      "index 1a2b3c4..5d6e7f8 100644",
      `--- a/${file}`,
      `+++ b/${file}`,
    );
    out.push("@@ -1,41 +1,41 @@");
    for (let k = 1; k <= 20; k++) out.push(` ${context(k)}`);
    if (f === 0)
      out.push("-  const tax = subtotal * 0.18;", "+  const tax = (subtotal - discount) * rate;");
    if (f === 1)
      out.push("-export const DEFAULT_RATE = 0.2;", "+export const DEFAULT_RATE = 0.18;");
    if (f === 2)
      out.push(
        "-  if (session.expiresAt < now) {",
        "+  if (session?.expiresAt !== undefined && session.expiresAt < now) {",
      );
    if (f === 3)
      out.push("-router.get('/v1/invoices', list);", "+router.get('/v2/invoices', list);");
    for (let k = 21; k <= 40; k++) out.push(` ${context(k)}`);
  }
  return `${out.join("\n")}\n`;
}

export function buildScenarios(): { scenario: Scenario; files: Record<string, string> }[] {
  const terminal = terminalLarge();
  const source = sourceCode();
  const failingFacts: Scenario["facts"] = [
    {
      id: "fail-1",
      kind: "contains",
      text: "FAIL  src/billing/invoice.test.ts > computes totals with tax",
    },
    { id: "error-1", kind: "contains", text: "AssertionError: expected 118.5 to be 118.05" },
    { id: "loc-1", kind: "contains", text: "src/billing/invoice.test.ts:42:19" },
    {
      id: "fail-2",
      kind: "contains",
      text: "FAIL  src/auth/session.test.ts > refreshes expired tokens",
    },
    {
      id: "error-2",
      kind: "contains",
      text: "TypeError: Cannot read properties of undefined (reading 'expiresAt')",
    },
    { id: "loc-2", kind: "contains", text: "at refresh (src/auth/session.ts:88:23)" },
    { id: "summary", kind: "contains", text: "Tests  2 failed | 940 passed (942)" },
  ];
  return [
    {
      files: { "input.log": terminal },
      scenario: {
        id: "terminal-large",
        title: "Large test run (safe policy)",
        task: "Identify the failing tests, their root errors and source locations.",
        input: "input.log",
        options: {},
        facts: failingFacts,
        recovery: [],
      },
    },
    {
      files: { "input.log": terminal },
      scenario: {
        id: "terminal-large-levels",
        title: "Large test run (warn+error levels, one fact needs recovery)",
        task: "Identify the failing tests and also report the slowest test.",
        input: "input.log",
        options: { selection: { logs: {} } },
        facts: [
          ...failingFacts,
          {
            id: "slowest",
            kind: "contains",
            text: "slowest test: src/report/export.test.ts 4200ms",
          },
        ],
        recovery: [{ selector: { type: "keyword", value: "slowest test" } }],
      },
    },
    {
      files: { "input.json": apiResponses() },
      scenario: {
        id: "api-responses",
        title: "Large API response (field selection)",
        task: "Report the email and plan of customers cus_0042 and cus_0137.",
        input: "input.json",
        options: {
          selection: { json: { include: ["$.data[*].id", "$.data[*].email", "$.data[*].plan"] } },
        },
        facts: [
          {
            id: "c42",
            kind: "json-record",
            array: "data",
            match: { id: "cus_0042" },
            expect: { email: "user0042@example.com" },
          },
          {
            id: "c137",
            kind: "json-record",
            array: "data",
            match: { id: "cus_0137" },
            expect: { email: "user0137@example.com" },
          },
        ],
        recovery: [],
      },
    },
    {
      files: { "input.md": duplicateHeavy() },
      scenario: {
        id: "duplicate-heavy",
        title: "Incident digest with repeated boilerplate",
        task: "List the unique events and how often the standard disclaimer appears.",
        input: "input.md",
        contentType: "text",
        options: {},
        facts: [
          ...Array.from({ length: 12 }, (_, i) => ({
            id: `event-${i + 1}`,
            kind: "contains" as const,
            text: `Event ${i + 1}: at `,
          })),
          {
            id: "disclaimer-count",
            kind: "occurrences",
            text: BOILERPLATE[0] as string,
            count: 24,
          },
        ],
        recovery: [],
      },
    },
    {
      files: { "input.md": documentation() },
      scenario: {
        id: "documentation",
        title: "Long handbook (section selection, one fact needs recovery)",
        task: "What is the default port, how do you fix EACCES at startup, and which Node version is required?",
        input: "input.md",
        options: { selection: { markdown: { sections: ["Configuration", "Troubleshooting"] } } },
        facts: [
          { id: "port", kind: "contains", text: "The default port is 7341" },
          { id: "eacces", kind: "contains", text: "tool doctor --fix-permissions" },
          { id: "node", kind: "contains", text: "minimum supported Node version is 22.13" },
        ],
        recovery: [{ selector: { type: "keyword", value: "Node version" } }],
      },
    },
    {
      files: { "input.ts": source.code },
      scenario: {
        id: "source-code",
        title: "Large module (line range around a known function)",
        task: "Explain how calculateInvoiceTotal computes tax.",
        input: "input.ts",
        options: {
          selection: { lines: { ranges: [{ start: source.start, end: source.end }], context: 2 } },
        },
        facts: [
          { id: "signature", kind: "contains", text: "export function calculateInvoiceTotal(" },
          { id: "tax", kind: "contains", text: "const tax = discounted * rate;" },
          { id: "return", kind: "contains", text: "return round(discounted + tax);" },
        ],
        recovery: [],
      },
    },
    {
      files: { "input.diff": sourceDiff() },
      scenario: {
        id: "source-diff",
        title: "Multi-file diff with wide context",
        task: "Summarize every change in the diff.",
        input: "input.diff",
        options: {},
        facts: [
          { id: "invoice", kind: "contains", text: "+  const tax = (subtotal - discount) * rate;" },
          { id: "rate", kind: "contains", text: "+export const DEFAULT_RATE = 0.18;" },
          {
            id: "session",
            kind: "contains",
            text: "+  if (session?.expiresAt !== undefined && session.expiresAt < now) {",
          },
          { id: "route", kind: "contains", text: "+router.get('/v2/invoices', list);" },
        ],
        recovery: [],
      },
    },
  ];
}

export function writeDatasets(root = DATASETS_DIR): string[] {
  const written: string[] = [];
  for (const { scenario, files } of buildScenarios()) {
    const dir = join(root, scenario.id);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    writeFileSync(join(dir, "scenario.json"), `${JSON.stringify(scenario, null, 2)}\n`);
    written.push(scenario.id);
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = writeDatasets();
  process.stderr.write(`generated ${ids.length} scenarios: ${ids.join(", ")}\n`);
}
