import { describe, expect, it } from "vitest";
import {
  buildLineIndex,
  detectLogLevel,
  isErrorLine,
  isStackFrameLine,
  parseMarkdownHeadings,
  slugify,
} from "../src/index.js";

describe("detectLogLevel", () => {
  it.each([
    ["2026-01-01 INFO started", "info"],
    ["[WARN] disk low", "warn"],
    ["level=error msg=boom", "error"],
    ["E FATAL out of memory", "fatal"],
    ["[debug] cache hit", "debug"],
    ["WARNING: deprecated", "warn"],
    ["CRITICAL failure", "fatal"],
    ["no level here", undefined],
    ["information about errors", undefined],
    ["INFORMATION", undefined],
  ])("%j → %s", (line, expected) => {
    expect(detectLogLevel(line)).toBe(expected);
  });
});

describe("isErrorLine / isStackFrameLine", () => {
  it.each([
    ["[ERROR] failed", true],
    ["TypeError: cannot read x", true],
    ["java.lang.NullPointerException", true],
    ["Traceback (most recent call last):", true],
    ["thread 'main' panicked at src/main.rs:2:5", true],
    ["FAIL src/a.test.ts", true],
    ["error[E0308]: mismatched types", true],
    ["all good", false],
    ["INFO no errors found", false],
  ])("isErrorLine(%j) = %s", (line, expected) => {
    expect(isErrorLine(line)).toBe(expected);
  });

  it.each([
    ["    at foo (a.js:1:2)", true],
    ['  File "x.py", line 3, in main', true],
    ["\t... 12 more", true],
    ["at the start", false],
  ])("isStackFrameLine(%j) = %s", (line, expected) => {
    expect(isStackFrameLine(line)).toBe(expected);
  });
});

describe("parseMarkdownHeadings", () => {
  const parse = (text: string) => parseMarkdownHeadings(text, buildLineIndex(text));

  it("ignores headings in tilde fences and requires matching closers", () => {
    const text = "~~~~\n# no\n~~~\n# still no\n~~~~\n# yes\n";
    expect(parse(text)).toEqual([{ level: 1, text: "yes", line: 6, id: "yes" }]);
  });

  it("handles CRLF, empty headings and setext level 2", () => {
    const text = "#\r\n\r\nSub\r\n---\r\n";
    expect(parse(text)).toEqual([
      { level: 1, text: "", line: 1, id: "section" },
      { level: 2, text: "Sub", line: 3, id: "sub" },
    ]);
  });

  it("does not treat list items or 7 hashes as headings", () => {
    expect(parse("####### seven\n- item\n---\n")).toEqual([]);
  });
});

describe("slugify", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["API: v2 (beta)!", "api-v2-beta"],
    ["Café déjà vu", "café-déjà-vu"],
    ["  spaced  ", "spaced"],
  ])("%j → %j", (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });
});
