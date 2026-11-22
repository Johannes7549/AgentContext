import {
  linesLocation,
  lineText,
  type NormalizedContext,
  type OmittedSegment,
  type ValidationIssue,
} from "@agentcontext/shared";
import { defineStrategy, marker, type Plan, plural, SegmentIds } from "./util.js";

/** Context lines kept on each side of a change in diff mode (git's default). */
export const DIFF_CONTEXT_LINES = 3;

/** Hunk header; groups 1 and 2 are the old and new line counts (default 1 when omitted). */
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const NUMBERED = /^ *(\d+) \| (.*)$/s;
const SUMMARY_PREFIX = "[diff summary:";

/**
 * Code extractor (roadmap §5, ADR-0009). Two modes, never invoking `git`:
 *
 * - **Line ranges** (explicit `selection.lines`): keeps the requested ranges
 *   plus `context` lines, prefixes kept lines with their original line number
 *   (`  42 | code`), and replaces the gaps with markers.
 * - **Unified diff** (input is diff text, no selection): adds a one-line
 *   per-file summary and collapses unchanged context runs longer than
 *   2 × DIFF_CONTEXT_LINES inside hunks, keeping DIFF_CONTEXT_LINES next to
 *   each change. Changed lines and headers are always kept.
 *
 * Plain code without a selection is not changed (R5). Omissions are recorded
 * with original line numbers and are recoverable. No symbol/AST parsing.
 */
export const codeExtractor = defineStrategy({
  name: "code-extractor",
  version: "1.0.0",
  supports: (context) => context.contentType === "code" && context.lines.count > 0,
  plan(context, _analysis, options): Plan {
    const selection = options.selection?.lines;
    if (selection) return planLineRanges(context, selection.ranges, selection.context ?? 0);
    if (isUnifiedDiff(context)) return planDiff(context);
    return {
      kind: "skip",
      reason: "code-extractor requires selection.lines (or unified diff input)",
    };
  },
  validate(context, output): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    let cursor = 1;
    for (const line of output.content.split("\n")) {
      if (line.startsWith("[... s") || line.startsWith(SUMMARY_PREFIX)) continue;
      const numbered = NUMBERED.exec(line);
      if (numbered) {
        const n = Number(numbered[1]);
        if (
          n < 1 ||
          n > context.lines.count ||
          lineText(context.original, context.lines, n) !== numbered[2]
        ) {
          issues.push({
            code: "CODE_LINE_MISMATCH",
            message: `Output line numbered ${n} does not match the original`,
          });
        }
        continue;
      }
      while (
        cursor <= context.lines.count &&
        lineText(context.original, context.lines, cursor) !== line
      )
        cursor++;
      if (cursor > context.lines.count) {
        issues.push({
          code: "CODE_LINE_UNKNOWN",
          message: "Output contains a line that is not in the original order",
        });
        break;
      }
      cursor++;
    }
    return issues;
  },
});

function planLineRanges(
  context: NormalizedContext,
  ranges: { start: number; end: number }[],
  extra: number,
): Plan {
  const count = context.lines.count;
  const kept = new Uint8Array(count + 2);
  for (const range of ranges) {
    if (range.start > count) continue;
    const from = Math.max(1, range.start - extra);
    const to = Math.min(count, range.end + extra);
    for (let n = from; n <= to; n++) kept[n] = 1;
  }
  if (!kept.includes(1))
    return { kind: "skip", reason: "requested lines are beyond the end of the content" };

  const width = String(count).length;
  const ids = new SegmentIds();
  const segments: OmittedSegment[] = [];
  const out: string[] = [];
  for (let n = 1; n <= count; ) {
    if (kept[n]) {
      out.push(`${String(n).padStart(width)} | ${lineText(context.original, context.lines, n)}`);
      n++;
      continue;
    }
    let end = n;
    while (end + 1 <= count && !kept[end + 1]) end++;
    const id = ids.next();
    out.push(marker(id, `${plural(end - n + 1, "line")} omitted (lines ${n}-${end})`));
    segments.push({
      id,
      type: "line_range",
      location: linesLocation(n, end),
      reason: "not_selected",
      recoverable: true,
    });
    n = end + 1;
  }
  if (segments.length === 0) return { kind: "skip", reason: "selection covers the whole content" };
  return {
    kind: "output",
    output: { content: out.join("\n"), omittedSegments: segments, warnings: [] },
  };
}

function isUnifiedDiff(context: NormalizedContext): boolean {
  let minus = false;
  let plus = false;
  for (let n = 1; n <= Math.min(context.lines.count, 400); n++) {
    const line = lineText(context.original, context.lines, n);
    if (line.startsWith("diff --git ")) return true;
    if (line.startsWith("--- ")) minus = true;
    else if (line.startsWith("+++ ")) plus = true;
    else if (minus && plus && HUNK_HEADER.test(line)) return true;
  }
  return false;
}

interface FileStat {
  name: string;
  added: number;
  removed: number;
}

function planDiff(context: NormalizedContext): Plan {
  const count = context.lines.count;
  const text = (n: number) => lineText(context.original, context.lines, n);
  const files: FileStat[] = [];
  const kind: ("header" | "context" | "change")[] = new Array(count + 1).fill("header");
  const hunkOf: number[] = new Array(count + 1).fill(0);
  let hunk = 0;
  let inHunk = false;
  /** True while the current file entry came from "diff --git" and has no "---" header yet. */
  let gitHeaderOpen = false;
  let oldLeft = 0;
  let newLeft = 0;
  let minusName = "";

  for (let n = 1; n <= count; n++) {
    const line = text(n);
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      gitHeaderOpen = true;
      files.push({ name: line.replace(/^diff --git a\/.* b\//, ""), added: 0, removed: 0 });
    } else if (!inHunk && line.startsWith("--- ")) {
      minusName = line.slice(4).replace(/^a\//, "");
      if (!gitHeaderOpen) files.push({ name: minusName, added: 0, removed: 0 });
      gitHeaderOpen = false;
    } else if (!inHunk && line.startsWith("+++ ")) {
      const plusName = line.slice(4).replace(/^b\//, "");
      const current = files.at(-1);
      if (current) current.name = plusName === "/dev/null" ? minusName : plusName;
    } else if (!inHunk && HUNK_HEADER.test(line)) {
      const header = HUNK_HEADER.exec(line) as RegExpExecArray;
      oldLeft = header[1] === undefined ? 1 : Number(header[1]);
      newLeft = header[2] === undefined ? 1 : Number(header[2]);
      inHunk = oldLeft + newLeft > 0;
      hunk++;
    } else if (inHunk) {
      hunkOf[n] = hunk;
      if (line.startsWith("+")) {
        kind[n] = "change";
        newLeft--;
        const current = files.at(-1);
        if (current) current.added++;
      } else if (line.startsWith("-")) {
        kind[n] = "change";
        oldLeft--;
        const current = files.at(-1);
        if (current) current.removed++;
      } else if (line.startsWith("\\")) {
        kind[n] = "header";
      } else {
        kind[n] = "context";
        oldLeft--;
        newLeft--;
      }
      if (oldLeft <= 0 && newLeft <= 0) inHunk = false;
    }
  }

  const omit = new Uint8Array(count + 1);
  for (let n = 1; n <= count; ) {
    if (kind[n] !== "context") {
      n++;
      continue;
    }
    let end = n;
    while (end + 1 <= count && kind[end + 1] === "context" && hunkOf[end + 1] === hunkOf[n]) end++;
    const changeBefore = n > 1 && kind[n - 1] === "change" && hunkOf[n - 1] === hunkOf[n];
    const changeAfter = end < count && kind[end + 1] === "change" && hunkOf[end + 1] === hunkOf[n];
    const keepHead = changeBefore ? DIFF_CONTEXT_LINES : 0;
    const keepTail = changeAfter ? DIFF_CONTEXT_LINES : 0;
    const from = n + keepHead;
    const to = end - keepTail;
    if (to - from + 1 >= 2) for (let k = from; k <= to; k++) omit[k] = 1;
    n = end + 1;
  }
  if (!omit.includes(1))
    return { kind: "skip", reason: "diff has no long unchanged context to collapse" };

  const ids = new SegmentIds();
  const segments: OmittedSegment[] = [];
  const totalAdded = files.reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = files.reduce((sum, f) => sum + f.removed, 0);
  const perFile = files.map((f) => `${f.name} (+${f.added} -${f.removed})`).join(", ");
  const out: string[] = [
    `${SUMMARY_PREFIX} ${plural(files.length, "file")} changed, +${totalAdded} -${totalRemoved}: ${perFile}]`,
  ];
  for (let n = 1; n <= count; ) {
    if (!omit[n]) {
      out.push(text(n));
      n++;
      continue;
    }
    let end = n;
    while (end + 1 <= count && omit[end + 1]) end++;
    const id = ids.next();
    out.push(marker(id, `${plural(end - n + 1, "unchanged line")} omitted (lines ${n}-${end})`));
    segments.push({
      id,
      type: "line_range",
      location: linesLocation(n, end),
      reason: "not_selected",
      recoverable: true,
      note: "unchanged diff context",
    });
    n = end + 1;
  }
  return {
    kind: "output",
    output: { content: out.join("\n"), omittedSegments: segments, warnings: [] },
  };
}
