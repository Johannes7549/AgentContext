import type { ContentType } from "@agentcontext/shared";
import { describe, expect, it } from "vitest";
import { detectContentType } from "../src/index.js";

/** Labelled detection corpus: [label, expected type, sample]. */
const corpus: [string, ContentType, string][] = [
  ["json object", "json", '{"users":[{"id":1,"email":"a@example.com"}],"total":1}'],
  ["json array", "json", '[\n  {"id": 1},\n  {"id": 2}\n]\n'],
  ["json with BOM", "json", '﻿{"a": true}'],
  [
    "iso timestamp log",
    "logs",
    "2026-11-22T10:00:00Z INFO server started\n2026-11-22T10:00:01Z WARN slow request\n2026-11-22T10:00:02Z ERROR connection refused\n",
  ],
  [
    "bracket level log",
    "logs",
    "[INFO] Building project\n[WARN] Deprecated API used\n[ERROR] Compilation failed\n[INFO] Done\n",
  ],
  [
    "syslog",
    "logs",
    "Nov 22 10:00:00 host sshd[123]: Accepted key\nNov 22 10:00:05 host sshd[123]: session opened\n",
  ],
  [
    "test runner output",
    "logs",
    " ✓ src/a.test.ts (3 tests)\n ✓ src/b.test.ts (2 tests)\n × src/c.test.ts > adds numbers\nFAIL src/c.test.ts\n",
  ],
  [
    "markdown doc",
    "markdown",
    "# Title\n\nIntro text with a [link](https://example.com).\n\n## Install\n\n- step one\n- step two\n",
  ],
  ["markdown single heading", "markdown", "# Notes\n\nSome **bold** words here.\n"],
  [
    "typescript",
    "code",
    'import { x } from "./x.js";\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n',
  ],
  ["python", "code", "import os\n\ndef main():\n    path = os.getcwd()\n    return path\n"],
  [
    "unified diff",
    "code",
    "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n",
  ],
  [
    "diff without git header",
    "code",
    "--- a/readme\n+++ b/readme\n@@ -1 +1 @@\n-hello\n+hello world\n",
  ],
  [
    "prose",
    "text",
    "The meeting covered the quarterly plan. Everyone agreed to review the budget next week.\nNo further action was needed.\n",
  ],
  ["single word", "text", "hello"],
  ["almost json", "text", "{ this is not json }"],
  ["empty", "unknown", ""],
  ["whitespace", "unknown", "  \n\t\n"],
];

describe("detectContentType — labelled corpus", () => {
  it.each(corpus)("%s → %s", (_label, expected, sample) => {
    expect(detectContentType(sample).contentType).toBe(expected);
  });

  it("achieves 100% accuracy on the corpus", () => {
    const correct = corpus.filter(
      ([, expected, sample]) => detectContentType(sample).contentType === expected,
    );
    expect(correct.length / corpus.length).toBe(1);
  });
});

describe("detectContentType — confidence and determinism", () => {
  it("reports high confidence for JSON and diffs, low for empty input", () => {
    expect(detectContentType('{"a":1}').confidence).toBe("high");
    expect(detectContentType("diff --git a/x b/x\n--- a/x\n+++ b/x\n").confidence).toBe("high");
    expect(detectContentType("").confidence).toBe("low");
  });

  it("is deterministic", () => {
    for (const [, , sample] of corpus) {
      expect(detectContentType(sample)).toEqual(detectContentType(sample));
    }
  });

  it("samples only the beginning of very large input", () => {
    const big = `${"2026-11-22T10:00:00Z INFO tick\n".repeat(500)}${"plain words here\n".repeat(100_000)}`;
    const started = performance.now();
    expect(detectContentType(big).contentType).toBe("logs");
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
