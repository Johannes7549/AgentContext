import { createHash } from "node:crypto";
import type { LineEnding, LineIndex } from "./domain.js";

/** Lowercase hex SHA-256 of `text` encoded as UTF-8. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** UTF-8 byte length of `text`. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Canonical JSON: object keys sorted (UTF-16 code unit order), no whitespace,
 * `undefined` object members omitted. Deterministic for equal JSON values.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * Build a line index (CONTRACTS.md conventions): lines are separated by "\n";
 * a preceding "\r" is part of the terminator. "" has 0 lines, and a trailing
 * terminator does not start a new line. A lone "\r" is not a terminator.
 */
export function buildLineIndex(text: string): LineIndex {
  if (text.length === 0) return { count: 0, lineStarts: [] };
  const lineStarts = [0];
  let at = text.indexOf("\n");
  while (at !== -1) {
    if (at + 1 < text.length) lineStarts.push(at + 1);
    at = text.indexOf("\n", at + 1);
  }
  return { count: lineStarts.length, lineStarts };
}

export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let at = text.indexOf("\n");
  while (at !== -1) {
    if (at > 0 && text.charCodeAt(at - 1) === 13) crlf++;
    else lf++;
    at = text.indexOf("\n", at + 1);
  }
  if (crlf === 0 && lf === 0) return "none";
  if (crlf > 0 && lf > 0) return "mixed";
  return crlf > 0 ? "crlf" : "lf";
}

/** Offsets [start, end) of `line` (1-based) including its terminator. */
export function lineSpan(
  text: string,
  index: LineIndex,
  line: number,
): { start: number; end: number } {
  assertLine(index, line);
  const start = index.lineStarts[line - 1] as number;
  const end = line < index.count ? (index.lineStarts[line] as number) : text.length;
  return { start, end };
}

/** Text of `line` (1-based) without its terminator. */
export function lineText(text: string, index: LineIndex, line: number): string {
  const { start, end } = lineSpan(text, index, line);
  let stop = end;
  if (stop > start && text.charCodeAt(stop - 1) === 10) stop--;
  if (stop > start && text.charCodeAt(stop - 1) === 13 && stop < end) stop--;
  return text.slice(start, stop);
}

/** Offsets [start, end) covering lines `from`..`to` (inclusive), terminators included. */
export function lineRangeSpan(
  text: string,
  index: LineIndex,
  from: number,
  to: number,
): { start: number; end: number } {
  if (to < from) throw new RangeError(`invalid line range ${from}-${to}`);
  return { start: lineSpan(text, index, from).start, end: lineSpan(text, index, to).end };
}

/** 1-based line containing UTF-16 `offset` (0 <= offset < text length). */
export function offsetToLine(index: LineIndex, offset: number): number {
  if (index.count === 0 || !Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`offset ${offset} is out of range`);
  }
  let low = 0;
  let high = index.count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((index.lineStarts[mid] as number) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function assertLine(index: LineIndex, line: number): void {
  if (!Number.isInteger(line) || line < 1 || line > index.count) {
    throw new RangeError(`line ${line} is out of range 1-${index.count}`);
  }
}
