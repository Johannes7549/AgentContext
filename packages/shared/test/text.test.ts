import { describe, expect, it } from "vitest";
import {
  buildLineIndex,
  canonicalJson,
  detectLineEnding,
  lineRangeSpan,
  lineSpan,
  lineText,
  offsetToLine,
  sha256Hex,
  utf8ByteLength,
} from "../src/index.js";

describe("sha256Hex", () => {
  it("hashes UTF-8 bytes", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("é")).not.toBe(sha256Hex("é"));
  });

  it("counts UTF-8 bytes", () => {
    expect(utf8ByteLength("aé😀")).toBe(1 + 2 + 4);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively without whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("is independent of key insertion order and omits undefined members", () => {
    expect(canonicalJson({ x: 1, y: undefined, z: "s" })).toBe(canonicalJson({ z: "s", x: 1 }));
  });
});

describe("buildLineIndex", () => {
  it.each([
    ["", 0, []],
    ["a", 1, [0]],
    ["a\n", 1, [0]],
    ["a\nb", 2, [0, 2]],
    ["a\n\nb\n", 3, [0, 2, 3]],
    ["\n", 1, [0]],
    ["a\r\nb\r\n", 2, [0, 3]],
    ["a\rb", 1, [0]],
  ])("indexes %j", (text, count, starts) => {
    expect(buildLineIndex(text)).toEqual({ count, lineStarts: starts });
  });
});

describe("detectLineEnding", () => {
  it.each([
    ["abc", "none"],
    ["a\nb", "lf"],
    ["a\r\nb\r\n", "crlf"],
    ["a\r\nb\nc", "mixed"],
    ["\n", "lf"],
  ])("detects %j as %s", (text, expected) => {
    expect(detectLineEnding(text)).toBe(expected);
  });
});

describe("line access", () => {
  const text = "first\r\nsecond\n\nlast";
  const index = buildLineIndex(text);

  it("returns line text without terminators", () => {
    expect([1, 2, 3, 4].map((n) => lineText(text, index, n))).toEqual([
      "first",
      "second",
      "",
      "last",
    ]);
  });

  it("returns spans that include terminators and rebuild the original", () => {
    const pieces = [1, 2, 3, 4].map((n) => {
      const { start, end } = lineSpan(text, index, n);
      return text.slice(start, end);
    });
    expect(pieces).toEqual(["first\r\n", "second\n", "\n", "last"]);
    expect(pieces.join("")).toBe(text);
  });

  it("returns multi-line spans", () => {
    const { start, end } = lineRangeSpan(text, index, 2, 3);
    expect(text.slice(start, end)).toBe("second\n\n");
  });

  it("keeps a lone carriage return inside line text", () => {
    const t = "a\rb\n";
    expect(lineText(t, buildLineIndex(t), 1)).toBe("a\rb");
  });

  it("maps offsets to lines", () => {
    expect(offsetToLine(index, 0)).toBe(1);
    expect(offsetToLine(index, 6)).toBe(1); // the \n of line 1
    expect(offsetToLine(index, 7)).toBe(2);
    expect(offsetToLine(index, 14)).toBe(3);
    expect(offsetToLine(index, text.length - 1)).toBe(4);
  });

  it.each([
    () => lineText(text, index, 0),
    () => lineText(text, index, 5),
    () => lineRangeSpan(text, index, 3, 2),
    () => offsetToLine(index, -1),
    () => offsetToLine(buildLineIndex(""), 0),
  ])("rejects out-of-range access %#", (fn) => {
    expect(fn).toThrow(RangeError);
  });
});
