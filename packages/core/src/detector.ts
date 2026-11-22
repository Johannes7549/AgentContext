import { type Confidence, type ContentType, detectLogLevel } from "@agentcontext/shared";

const SAMPLE_LINES = 400;

const TIMESTAMP_START =
  /^\s*\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}|\d{10,13}\b)/;
const TEST_RUNNER_LINE = /^\s*(?:✓|✔|✗|×|✕|PASS|FAIL|ok \d|not ok \d|RUN|---)\s/;
const CODE_LINE =
  /^\s*(?:import |export |from \S+ import|const |let |var |function |class |interface |type \w+ =|def |return\b|if \(|for \(|while \(|public |private |protected |#include|package |fn |func |use |impl |struct |enum |@\w+)|[;{}]\s*$|=>\s*\{?\s*$/;
const MD_HEADING = /^ {0,3}#{1,6}\s+\S/;
const MD_OTHER = /^ {0,3}(?:```|~~~|[-*+] \S|\d+\. \S|> )|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/;

/**
 * Deterministic content-type detection used when the caller gives no type.
 * Order of checks: JSON → unified diff → logs → Markdown → code → text.
 * Returns "unknown" only for empty/whitespace-only input.
 */
export function detectContentType(text: string): {
  contentType: ContentType;
  confidence: Confidence;
} {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const trimmed = body.trim();
  if (trimmed.length === 0) return { contentType: "unknown", confidence: "low" };

  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && isJson(trimmed)) {
    return { contentType: "json", confidence: "high" };
  }

  const lines = sampleLines(body);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);

  if (isUnifiedDiff(nonEmpty)) return { contentType: "code", confidence: "high" };

  const logRatio = ratio(
    nonEmpty,
    (line) =>
      TIMESTAMP_START.test(line) ||
      TEST_RUNNER_LINE.test(line) ||
      (detectLogLevel(line) !== undefined && /^\s*\[?[A-Za-z]+\]?[\s:]/.test(line)),
  );
  if (logRatio >= 0.5 && nonEmpty.length >= 2) {
    return { contentType: "logs", confidence: logRatio >= 0.8 ? "high" : "medium" };
  }

  const headings = nonEmpty.filter((line) => MD_HEADING.test(line)).length;
  const mdSignals = nonEmpty.filter((line) => MD_OTHER.test(line)).length;
  if (headings >= 2 || (headings >= 1 && mdSignals >= 1)) {
    return {
      contentType: "markdown",
      confidence: headings >= 2 && mdSignals >= 1 ? "high" : "medium",
    };
  }

  const codeRatio = ratio(nonEmpty, (line) => CODE_LINE.test(line));
  if (codeRatio >= 0.3 && nonEmpty.length >= 2) {
    return { contentType: "code", confidence: codeRatio >= 0.6 ? "high" : "medium" };
  }

  if (mdSignals >= 2) return { contentType: "markdown", confidence: "low" };
  return { contentType: "text", confidence: logRatio > 0 || codeRatio > 0 ? "low" : "medium" };
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isUnifiedDiff(lines: string[]): boolean {
  const first = lines[0] ?? "";
  if (first.startsWith("diff --git ")) return true;
  const hasHeaders =
    lines.some((line) => line.startsWith("--- ")) && lines.some((line) => line.startsWith("+++ "));
  return hasHeaders && lines.some((line) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line));
}

function sampleLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  while (lines.length < SAMPLE_LINES && start <= text.length) {
    const end = text.indexOf("\n", start);
    if (end === -1) {
      lines.push(text.slice(start));
      break;
    }
    lines.push(text.slice(start, end).replace(/\r$/, ""));
    start = end + 1;
  }
  return lines;
}

function ratio(lines: string[], predicate: (line: string) => boolean): number {
  if (lines.length === 0) return 0;
  return lines.filter(predicate).length / lines.length;
}
