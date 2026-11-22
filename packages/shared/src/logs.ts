import type { LogLevel } from "./input.js";

const LEVEL_PATTERN =
  /(?:^|[\s[(|:=])(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|SEVERE|FATAL|CRITICAL|CRIT|PANIC|trace|debug|info|warn|warning|error|fatal|critical)(?=$|[\s\]):|,;])/;

const LEVEL_MAP: Record<string, LogLevel> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  notice: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  err: "error",
  severe: "error",
  fatal: "fatal",
  critical: "fatal",
  crit: "fatal",
  panic: "fatal",
};

/**
 * Detect the log level of a single line, or `undefined` when none is present.
 * Matches upper-case level words anywhere as a token, and lower-case level words
 * only as whole tokens (e.g. "level=error", "[warn]"). Deterministic.
 */
export function detectLogLevel(line: string): LogLevel | undefined {
  const match = LEVEL_PATTERN.exec(line);
  return match?.[1] ? LEVEL_MAP[match[1].toLowerCase()] : undefined;
}

const ERROR_LINE_PATTERNS = [
  /^\s*Traceback \(most recent call last\)/,
  /\b[A-Z][A-Za-z0-9_]*(?:Error|Exception)\b(?::|$)/,
  /\bpanicked at\b/,
  /^\s*(?:FAIL|FAILED|✗|×|✕)\s/,
  /^\s*error(?:\[[A-Z0-9]+\])?:/,
];

/**
 * True for lines that report an error even without a level token
 * (stack-trace headers, exception names, test failures, compiler errors).
 */
export function isErrorLine(line: string): boolean {
  const level = detectLogLevel(line);
  if (level === "error" || level === "fatal") return true;
  return ERROR_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/** True for stack-frame continuation lines (JS, Python, Java/.NET, Go, Rust). */
export function isStackFrameLine(line: string): boolean {
  return (
    /^\s+at\s+\S/.test(line) ||
    /^\s+File ".*", line \d+/.test(line) ||
    /^\s+\.{3} \d+ more$/.test(line) ||
    /^\s+[\w./-]+\.go:\d+/.test(line) ||
    /^\s+\d+: \S/.test(line)
  );
}
