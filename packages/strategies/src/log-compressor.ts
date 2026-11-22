import {
  detectLogLevel,
  isErrorLine,
  isStackFrameLine,
  joinLocations,
  type LogLevel,
  linesLocation,
  lineText,
  type OmittedSegment,
  type ValidationIssue,
} from "@agentcontext/shared";
import {
  defineStrategy,
  describeRanges,
  marker,
  type Plan,
  plural,
  SegmentIds,
  toRanges,
} from "./util.js";

export const DEFAULT_KEPT_LEVELS: LogLevel[] = ["error", "fatal", "warn"];

const TIMESTAMP_PREFIX =
  /^\s*\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2})\]?\s*/;

/** Message used for grouping: the line without a leading timestamp or trailing whitespace. */
export function messageKey(line: string): string {
  return line.replace(TIMESTAMP_PREFIX, "").trimEnd();
}

interface LineInfo {
  text: string;
  level: LogLevel | undefined;
  error: boolean;
  frame: boolean;
  kept: boolean;
}

/**
 * Log compressor (roadmap §5).
 *
 * Always (safe policy): lines whose message is identical apart from a leading
 * timestamp are grouped; the first `maxGroupExamples` (default 1) occurrences
 * stay in place and the rest are replaced by one marker with the count and
 * original line numbers. Stack-frame lines and blank lines are never grouped.
 *
 * Only with an explicit `selection.logs`: lines whose level is not in
 * `levels` (default error, fatal, warn) are omitted in runs. Lines without a
 * level inherit the previous line's level; error lines (exceptions, test
 * failures, tracebacks) are always kept, as are lines before the first level.
 *
 * Every omission is recorded with original line numbers and is recoverable.
 */
export const logCompressor = defineStrategy({
  name: "log-compressor",
  version: "1.0.1",
  supports: (context) => context.contentType === "logs" && context.lines.count > 0,
  plan(context, _analysis, options): Plan {
    const policy = options.selection?.logs;
    const keptLevels = policy ? new Set(policy.levels ?? DEFAULT_KEPT_LEVELS) : undefined;
    const maxExamples = policy?.maxGroupExamples ?? 1;

    const lines: LineInfo[] = [];
    let inherited: LogLevel | undefined;
    let previous: LogLevel | undefined;
    for (let n = 1; n <= context.lines.count; n++) {
      const text = lineText(context.original, context.lines, n);
      const own = detectLogLevel(text);
      const error = isErrorLine(text);
      const frame = isStackFrameLine(text);
      if (own) inherited = own;
      // Stack frames belong to the line above them (often a level-less exception line);
      // other unlevelled lines continue the last explicit level.
      const level: LogLevel | undefined = error ? "error" : (own ?? (frame ? previous : inherited));
      const kept = !keptLevels || level === undefined || keptLevels.has(level) || error;
      lines.push({ text, level, error, frame, kept });
      previous = level;
    }

    // Occurrences of each groupable message among kept lines.
    const occurrences = new Map<string, number[]>();
    lines.forEach((line, i) => {
      if (!line.kept || line.frame || line.text.trim() === "") return;
      const key = messageKey(line.text);
      const list = occurrences.get(key);
      if (list) list.push(i + 1);
      else occurrences.set(key, [i + 1]);
    });

    const ids = new SegmentIds();
    const segments: OmittedSegment[] = [];
    const out: string[] = [];
    let run: number[] = [];

    const flushRun = () => {
      if (run.length === 0) return;
      const id = ids.next();
      const counts = new Map<string, number>();
      for (const n of run) {
        const level = lines[n - 1]?.level ?? "unlevelled";
        counts.set(level, (counts.get(level) ?? 0) + 1);
      }
      const summary = [...counts].map(([level, count]) => `${level} x${count}`).join(", ");
      const ranges = toRanges(run);
      out.push(
        marker(
          id,
          `${plural(run.length, "line")} below kept levels omitted (${summary}; lines ${describeRanges(ranges)})`,
        ),
      );
      segments.push({
        id,
        type: "log_lines",
        location: joinLocations(ranges.map((r) => linesLocation(r.start, r.end))),
        reason: "below_log_level",
        recoverable: true,
        note: `${plural(run.length, "line")} (${summary})`,
      });
      run = [];
    };

    lines.forEach((line, i) => {
      const n = i + 1;
      if (!line.kept) {
        run.push(n);
        return;
      }
      flushRun();
      if (line.frame || line.text.trim() === "") {
        out.push(line.text);
        return;
      }
      const all = occurrences.get(messageKey(line.text)) as number[];
      const index = all.indexOf(n);
      if (index >= maxExamples) return;
      out.push(line.text);
      if (index === maxExamples - 1 && all.length > maxExamples) {
        const omitted = all.slice(maxExamples);
        const ranges = toRanges(omitted);
        const id = ids.next();
        out.push(
          marker(
            id,
            `repeated ${plural(omitted.length, "more time")} (lines ${describeRanges(ranges)})`,
          ),
        );
        segments.push({
          id,
          type: "log_group",
          location: joinLocations(ranges.map((r) => linesLocation(r.start, r.end))),
          reason: "repeated_log_line",
          recoverable: true,
          occurrences: all.length,
          note: `identical message repeated ${all.length} times`,
        });
      }
    });
    flushRun();

    if (segments.length === 0)
      return { kind: "skip", reason: "no repeated or below-level lines to omit" };
    return {
      kind: "output",
      output: { content: out.join("\n"), omittedSegments: segments, warnings: [] },
    };
  },
  validate(context, output): ValidationIssue[] {
    const kept = new Set(output.content.split("\n").map(messageKey));
    const issues: ValidationIssue[] = [];
    for (let n = 1; n <= context.lines.count; n++) {
      const text = lineText(context.original, context.lines, n);
      if (isErrorLine(text) && !kept.has(messageKey(text))) {
        issues.push({
          code: "LOG_ERROR_DROPPED",
          message: `Error event at line ${n} is missing from the output`,
          location: linesLocation(n, n),
        });
      }
    }
    return issues;
  },
});
