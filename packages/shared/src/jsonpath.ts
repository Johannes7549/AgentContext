import { AgentContextError } from "./errors.js";

/**
 * Restricted JSONPath subset (ADR-0005), RFC 9535 semantics:
 *
 *   $                     root
 *   .name  ['name']  ["name"]   member
 *   [n]                   index (negative counts from the end)
 *   [start:end:step]      slice (each part optional)
 *   .*  [*]               wildcard (object members in insertion order, array elements)
 *
 * Rejected with UNSUPPORTED_JSONPATH: descendant `..`, filters `?()`, script `()`,
 * unions `[a,b]`, functions, and any malformed syntax. No dynamic code is evaluated.
 */
export type JsonPathSegment =
  | { type: "name"; name: string }
  | { type: "index"; index: number }
  | { type: "slice"; start?: number; end?: number; step?: number }
  | { type: "wildcard" };

export interface JsonPathMatch {
  /** RFC 9535 normalized path, e.g. `$['items'][0]['id']`. */
  path: string;
  value: unknown;
}

export const MAX_JSONPATH_LENGTH = 1_000;
export const MAX_JSONPATH_SEGMENTS = 64;
export const DEFAULT_MAX_JSONPATH_RESULTS = 10_000;

const MAX_INT = Number.MAX_SAFE_INTEGER;

export function parseJsonPath(path: string): JsonPathSegment[] {
  if (path.length > MAX_JSONPATH_LENGTH) fail("path is too long", 0);
  if (path[0] !== "$") fail("path must start with $", 0);
  const segments: JsonPathSegment[] = [];
  let pos = 1;

  while (pos < path.length) {
    const ch = path[pos];
    if (ch === ".") {
      if (path[pos + 1] === ".") fail("descendant segments (..) are not supported", pos);
      pos++;
      if (path[pos] === "*") {
        segments.push({ type: "wildcard" });
        pos++;
        continue;
      }
      const start = pos;
      if (pos >= path.length || !isNameFirst(path.codePointAt(pos) as number)) {
        fail("expected a member name after '.'", pos);
      }
      while (pos < path.length && isNameChar(path.codePointAt(pos) as number)) {
        pos += (path.codePointAt(pos) as number) > 0xffff ? 2 : 1;
      }
      segments.push({ type: "name", name: path.slice(start, pos) });
    } else if (ch === "[") {
      pos = skipSpace(path, pos + 1);
      const [segment, next] = parseSelector(path, pos);
      pos = skipSpace(path, next);
      if (path[pos] === ",") fail("union selectors are not supported", pos);
      if (path[pos] !== "]") fail("expected ']'", pos);
      segments.push(segment);
      pos++;
    } else {
      fail(`unexpected character`, pos);
    }
    if (segments.length > MAX_JSONPATH_SEGMENTS) fail("path has too many segments", pos);
  }
  return segments;
}

function parseSelector(path: string, pos: number): [JsonPathSegment, number] {
  const ch = path[pos];
  if (ch === "'" || ch === '"') {
    const [name, next] = parseString(path, pos);
    return [{ type: "name", name }, next];
  }
  if (ch === "*") return [{ type: "wildcard" }, pos + 1];
  if (ch === "?") fail("filter selectors are not supported", pos);
  if (ch === "(") fail("script expressions are not supported", pos);

  const parts: (number | undefined)[] = [];
  let colons = 0;
  let cursor = pos;
  for (;;) {
    cursor = skipSpace(path, cursor);
    const int = /^-?(?:0|[1-9]\d*)/.exec(path.slice(cursor, cursor + 20));
    if (int) {
      if (int[0] === "-0") fail("-0 is not a valid integer", cursor);
      const value = Number(int[0]);
      if (Math.abs(value) > MAX_INT) fail("integer is out of range", cursor);
      parts.push(value);
      cursor += int[0].length;
    } else {
      parts.push(undefined);
    }
    cursor = skipSpace(path, cursor);
    if (path[cursor] === ":" && colons < 2) {
      colons++;
      cursor++;
      continue;
    }
    break;
  }

  if (colons === 0) {
    if (parts[0] === undefined) fail("expected a selector", pos);
    return [{ type: "index", index: parts[0] }, cursor];
  }
  const [start, end, step] = parts;
  const slice: JsonPathSegment = { type: "slice" };
  if (start !== undefined) slice.start = start;
  if (end !== undefined) slice.end = end;
  if (step !== undefined) slice.step = step;
  return [slice, cursor];
}

function parseString(path: string, pos: number): [string, number] {
  const quote = path[pos];
  let out = "";
  let i = pos + 1;
  while (i < path.length) {
    const ch = path[i] as string;
    if (ch === quote) return [out, i + 1];
    if (ch.charCodeAt(0) < 0x20) fail("control characters must be escaped", i);
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }
    const esc = path[i + 1];
    const simple: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      "/": "/",
      "\\": "\\",
    };
    if (esc !== undefined && esc in simple) {
      out += simple[esc];
      i += 2;
    } else if (esc === quote) {
      out += quote;
      i += 2;
    } else if (esc === "u") {
      const hex = path.slice(i + 2, i + 6);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail("invalid \\u escape", i);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
    } else {
      fail("invalid escape sequence", i);
    }
  }
  return fail("unterminated string", pos);
}

/**
 * Evaluate `path` against a parsed JSON value. Results are in document order.
 * Throws UNSUPPORTED_JSONPATH for unsupported syntax and TOO_LARGE when more
 * than `maxResults` nodes would be selected at any step.
 */
export function queryJsonPath(
  root: unknown,
  path: string | JsonPathSegment[],
  { maxResults = DEFAULT_MAX_JSONPATH_RESULTS }: { maxResults?: number } = {},
): JsonPathMatch[] {
  const segments = typeof path === "string" ? parseJsonPath(path) : path;
  let nodes: { value: unknown; path: (string | number)[] }[] = [{ value: root, path: [] }];

  for (const segment of segments) {
    const next: typeof nodes = [];
    const push = (value: unknown, key: string | number, parent: (string | number)[]) => {
      if (next.length >= maxResults) {
        throw new AgentContextError("TOO_LARGE", "JSONPath selects too many nodes", { maxResults });
      }
      next.push({ value, path: [...parent, key] });
    };
    for (const node of nodes) {
      const { value } = node;
      if (Array.isArray(value)) {
        if (segment.type === "index") {
          const i = segment.index < 0 ? value.length + segment.index : segment.index;
          if (i >= 0 && i < value.length) push(value[i], i, node.path);
        } else if (segment.type === "wildcard") {
          for (const [i, item] of value.entries()) push(item, i, node.path);
        } else if (segment.type === "slice") {
          for (const i of sliceIndices(value.length, segment)) push(value[i], i, node.path);
        }
      } else if (isObject(value)) {
        if (segment.type === "name") {
          if (Object.hasOwn(value, segment.name))
            push(value[segment.name], segment.name, node.path);
        } else if (segment.type === "wildcard") {
          for (const key of Object.keys(value)) push(value[key], key, node.path);
        }
      }
    }
    nodes = next;
  }
  return nodes.map((node) => ({ path: normalizedPath(node.path), value: node.value }));
}

/** RFC 9535 §2.3.4.2 slice indices. */
function sliceIndices(
  length: number,
  slice: Extract<JsonPathSegment, { type: "slice" }>,
): number[] {
  const step = slice.step ?? 1;
  if (step === 0) return [];
  const normalize = (i: number) => (i >= 0 ? i : length + i);
  const indices: number[] = [];
  if (step > 0) {
    const lower = Math.min(Math.max(normalize(slice.start ?? 0), 0), length);
    const upper = Math.min(Math.max(normalize(slice.end ?? length), 0), length);
    for (let i = lower; i < upper; i += step) indices.push(i);
  } else {
    const upper = Math.min(Math.max(normalize(slice.start ?? length - 1), -1), length - 1);
    const lower = Math.min(
      Math.max(slice.end === undefined ? -1 : normalize(slice.end), -1),
      length - 1,
    );
    for (let i = upper; lower < i; i += step) indices.push(i);
  }
  return indices;
}

/** Build an RFC 9535 normalized path from member names and array indices. */
export function normalizedPath(parts: readonly (string | number)[]): string {
  return `$${parts.map((p) => (typeof p === "number" ? `[${p}]` : `['${escapeName(p)}']`)).join("")}`;
}

function escapeName(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (ch === "'") out += "\\'";
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out;
}

/**
 * Resolve a normalized path (names and non-wildcard indices only) to a single
 * value. Returns `{ found: false }` for missing nodes or non-singular paths.
 */
export function resolveNormalizedPath(
  root: unknown,
  path: string,
): { found: true; value: unknown } | { found: false } {
  let segments: JsonPathSegment[];
  try {
    segments = parseJsonPath(path);
  } catch {
    return { found: false };
  }
  let current: unknown = root;
  for (const segment of segments) {
    if (segment.type === "name" && isObject(current) && Object.hasOwn(current, segment.name)) {
      current = current[segment.name];
    } else if (
      segment.type === "index" &&
      Array.isArray(current) &&
      segment.index >= 0 &&
      segment.index < current.length
    ) {
      current = current[segment.index];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/** Boolean form of resolveNormalizedPath, suitable as a validator resolver. */
export function jsonPathResolves(root: unknown, path: string): boolean {
  return resolveNormalizedPath(root, path).found;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNameFirst(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    (code >= 0x80 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0x10ffff)
  );
}

function isNameChar(code: number): boolean {
  return isNameFirst(code) || (code >= 0x30 && code <= 0x39);
}

function skipSpace(path: string, pos: number): number {
  let i = pos;
  while (i < path.length && " \t\n\r".includes(path[i] as string)) i++;
  return i;
}

function fail(message: string, position: number): never {
  throw new AgentContextError(
    "UNSUPPORTED_JSONPATH",
    `Invalid or unsupported JSONPath: ${message}`,
    {
      position,
    },
  );
}
