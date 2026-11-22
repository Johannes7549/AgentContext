import {
  joinLocations,
  linesLocation,
  lineText,
  type NormalizedContext,
  type OmittedSegment,
  parseLocations,
  type ValidationIssue,
} from "@agentcontext/shared";
import { defineStrategy, marker, type Plan, plural, SegmentIds } from "./util.js";

/** Units shorter than this (trimmed characters) are never collapsed: a marker would not save anything. */
export const MIN_DUPLICATE_CHARS = 40;

interface Unit {
  start: number;
  end: number;
  key: string;
}

/**
 * Duplicate eliminator (roadmap §5). Collapses exact duplicates only:
 * paragraphs (blank-line separated) for text/markdown, lines for logs and
 * unknown content. Units compare equal after removing trailing whitespace;
 * units shorter than MIN_DUPLICATE_CHARS are ignored. The first occurrence
 * stays in place; later occurrences become markers that name the first
 * occurrence's lines. One recoverable segment per duplicate group records the
 * total count and every omitted location. Code and JSON are not supported.
 */
export const duplicateEliminator = defineStrategy({
  name: "duplicate-eliminator",
  version: "1.0.0",
  confidence: "medium",
  supports: (context) =>
    ["text", "markdown", "logs", "unknown"].includes(context.contentType) &&
    context.lines.count > 1,
  plan(context): Plan {
    const units = splitUnits(context);
    const groups = new Map<string, Unit[]>();
    for (const unit of units) {
      if (unit.key.trim().length < MIN_DUPLICATE_CHARS) continue;
      const list = groups.get(unit.key);
      if (list) list.push(unit);
      else groups.set(unit.key, [unit]);
    }

    const omittedStart = new Map<number, { unit: Unit; first: Unit; groupKey: string }>();
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      const first = list[0] as Unit;
      for (const unit of list.slice(1))
        omittedStart.set(unit.start, { unit, first, groupKey: key });
    }
    if (omittedStart.size === 0) return { kind: "skip", reason: "no exact duplicates to collapse" };

    const ids = new SegmentIds();
    const groupIds = new Map<string, string>();
    const segments: OmittedSegment[] = [];
    const out: string[] = [];
    let lastMarker: { id: string; end: number; count: number } | undefined;

    for (let n = 1; n <= context.lines.count; ) {
      const hit = omittedStart.get(n);
      if (!hit) {
        out.push(lineText(context.original, context.lines, n));
        lastMarker = undefined;
        n++;
        continue;
      }
      let id = groupIds.get(hit.groupKey);
      if (!id) {
        id = ids.next();
        groupIds.set(hit.groupKey, id);
        const list = groups.get(hit.groupKey) as Unit[];
        const omitted = list.slice(1);
        segments.push({
          id,
          type: "duplicate_block",
          location: joinLocations(omitted.map((u) => linesLocation(u.start, u.end))),
          reason: "duplicate",
          recoverable: true,
          occurrences: list.length,
          note: `${plural(omitted.length, "duplicate")} of ${span(hit.first)}`,
        });
      }
      const firstDesc = span(hit.first);
      if (lastMarker && lastMarker.id === id && lastMarker.end === n - 1) {
        lastMarker.count++;
        lastMarker.end = hit.unit.end;
        out[out.length - 1] = marker(
          id,
          `${plural(lastMarker.count, "duplicate")} of ${firstDesc}`,
        );
      } else {
        out.push(marker(id, `duplicate of ${firstDesc}`));
        lastMarker = { id, end: hit.unit.end, count: 1 };
      }
      n = hit.unit.end + 1;
    }

    return {
      kind: "output",
      output: { content: out.join("\n"), omittedSegments: segments, warnings: [] },
    };
  },
  validate(context, output): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const segment of output.omittedSegments) {
      let texts: string[];
      try {
        texts = parseLocations(segment.location).map((part) =>
          part.kind === "lines" ? rangeKey(context, part.start, part.end) : "",
        );
      } catch {
        continue; // malformed locations are reported by the generic validator
      }
      const first = texts[0] ?? "";
      if (texts.some((t) => t !== first) || first === "") {
        issues.push({
          code: "DUPLICATE_MISMATCH",
          message: `Segment ${segment.id} groups content that is not identical`,
          location: segment.location,
        });
      } else if (!output.content.includes(first.split("\n")[0] as string)) {
        issues.push({
          code: "DUPLICATE_ORIGINAL_MISSING",
          message: `Segment ${segment.id} has no kept first occurrence in the output`,
          location: segment.location,
        });
      }
      if (segment.occurrences !== texts.length + 1) {
        issues.push({
          code: "DUPLICATE_COUNT_MISMATCH",
          message: `Segment ${segment.id} occurrence count does not match its locations`,
          location: segment.location,
        });
      }
    }
    return issues;
  },
});

function splitUnits(context: NormalizedContext): Unit[] {
  const byParagraph = context.contentType === "text" || context.contentType === "markdown";
  const units: Unit[] = [];
  if (!byParagraph) {
    for (let n = 1; n <= context.lines.count; n++) {
      units.push({ start: n, end: n, key: lineText(context.original, context.lines, n).trimEnd() });
    }
    return units;
  }
  let start = 0;
  for (let n = 1; n <= context.lines.count + 1; n++) {
    const blank =
      n > context.lines.count || lineText(context.original, context.lines, n).trim() === "";
    if (blank) {
      if (start) units.push({ start, end: n - 1, key: rangeKey(context, start, n - 1) });
      start = 0;
    } else if (!start) {
      start = n;
    }
  }
  return units;
}

function rangeKey(context: NormalizedContext, start: number, end: number): string {
  const lines: string[] = [];
  for (let n = start; n <= end; n++)
    lines.push(lineText(context.original, context.lines, n).trimEnd());
  return lines.join("\n");
}

function span(unit: Unit): string {
  return unit.start === unit.end ? `line ${unit.start}` : `lines ${unit.start}-${unit.end}`;
}
