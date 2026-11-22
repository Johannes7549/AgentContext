/**
 * Structured logger writing one JSON object per line to stderr (stdout is the
 * MCP JSON-RPC channel). Never logs raw content: fields whose names suggest
 * content are replaced by their length, and secret-looking values are masked.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Output function; defaults to process.stderr. */
  write?: (line: string) => void;
  /** Clock (injectable for tests). */
  now?: () => Date;
  /** Fields added to every record. */
  base?: Record<string, unknown>;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field names whose values are content and must never be written. */
export const CONTENT_FIELDS = new Set([
  "content",
  "text",
  "original",
  "optimizedcontent",
  "inlinecontent",
  "inline_content",
  "optimized_content",
  "body",
  "data",
  "stdout",
  "stderr",
  "output",
  "input",
  "args",
  "arguments",
  "env",
  "prompt",
]);

const SECRET_FIELD =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(?<=[?&](?:token|key|password|secret)=)[^&\s]+/gi,
];

const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? "info"];
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  const log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < threshold) return;
    const record = {
      time: now().toISOString(),
      level,
      msg: redactString(message),
      ...(redact({ ...base, ...fields }, 0) as Record<string, unknown>),
    };
    try {
      write(`${JSON.stringify(record)}\n`);
    } catch {
      // logging must never break the caller
    }
  };

  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

/** Logger that discards everything (tests, embedding). */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

/** Redact a value for logging (exported for tests and other sinks). */
export function redact(value: unknown, depth = 0, key = ""): unknown {
  const lowered = key.toLowerCase();
  if (key && CONTENT_FIELDS.has(lowered)) return describeContent(value);
  if (key && SECRET_FIELD.test(key)) return "[redacted]";
  if (value instanceof Error) {
    return {
      name: value.name,
      ...("code" in value ? { code: (value as { code: unknown }).code } : {}),
    };
  }
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redact(v, depth + 1, k);
  return out;
}

export function redactString(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.length > MAX_STRING
    ? `${out.slice(0, MAX_STRING)}…[+${out.length - MAX_STRING} chars]`
    : out;
}

function describeContent(value: unknown): string {
  if (typeof value === "string") return `[content: ${value.length} chars]`;
  if (Array.isArray(value)) return `[content: ${value.length} items]`;
  if (value === undefined || value === null) return String(value);
  return "[content]";
}
