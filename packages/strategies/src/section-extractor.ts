import {
  linesLocation,
  lineText,
  type MarkdownHeading,
  type OmittedSegment,
  parseLocations,
  parseMarkdownHeadings,
  type ValidationIssue,
} from "@agentcontext/shared";
import { defineStrategy, marker, type Plan, SegmentIds } from "./util.js";

interface OwnRange {
  start: number;
  end: number;
  heading?: MarkdownHeading;
}

/**
 * Markdown section extractor (roadmap §5). Applies only with an explicit
 * `selection.markdown.sections` (heading text, case-insensitive, or heading
 * id/slug). A selected section includes its subsections. Every other part of
 * the document — the preamble and each unselected section's own lines — is
 * replaced by a marker naming its heading, so the output doubles as an outline
 * of what was omitted. Prose is never summarized; omissions are recoverable.
 */
export const sectionExtractor = defineStrategy({
  name: "section-extractor",
  version: "1.0.0",
  supports: (context) => context.contentType === "markdown" && context.lines.count > 0,
  plan(context, _analysis, options): Plan {
    const wanted = options.selection?.markdown?.sections;
    if (!wanted?.length) {
      return { kind: "skip", reason: "section-extractor requires selection.markdown.sections" };
    }
    const headings = parseMarkdownHeadings(context.original, context.lines);
    if (headings.length === 0) return { kind: "skip", reason: "document has no headings" };

    const wantedLower = new Set(wanted.map((w) => w.toLowerCase()));
    const matches = (h: MarkdownHeading) =>
      wantedLower.has(h.text.toLowerCase()) || wanted.includes(h.id);
    const matched = headings.filter(matches);
    if (matched.length === 0)
      return { kind: "skip", reason: "no requested section matched a heading" };

    const kept = new Uint8Array(context.lines.count + 1);
    headings.forEach((heading, i) => {
      if (!matches(heading)) return;
      const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
      const end = next ? next.line - 1 : context.lines.count;
      for (let n = heading.line; n <= end; n++) kept[n] = 1;
    });

    const ranges: OwnRange[] = [];
    const first = headings[0] as MarkdownHeading;
    if (first.line > 1) ranges.push({ start: 1, end: first.line - 1 });
    headings.forEach((heading, i) => {
      const next = headings[i + 1];
      ranges.push({
        start: heading.line,
        end: next ? next.line - 1 : context.lines.count,
        heading,
      });
    });

    const ids = new SegmentIds();
    const segments: OmittedSegment[] = [];
    const out: string[] = [];
    for (const range of ranges) {
      if (kept[range.start]) {
        for (let n = range.start; n <= range.end; n++)
          out.push(lineText(context.original, context.lines, n));
        continue;
      }
      const id = ids.next();
      const label = range.heading
        ? `section "${"#".repeat(range.heading.level)} ${range.heading.text}"`
        : "preamble";
      const where =
        range.start === range.end ? `line ${range.start}` : `lines ${range.start}-${range.end}`;
      out.push(marker(id, `${label} omitted (${where})`));
      segments.push({
        id,
        type: "section",
        location: linesLocation(range.start, range.end),
        reason: "not_selected",
        recoverable: true,
        note: range.heading
          ? `${"#".repeat(range.heading.level)} ${range.heading.text}`.slice(0, 200)
          : "preamble",
      });
    }

    if (segments.length === 0)
      return { kind: "skip", reason: "selection covers the whole document" };
    const unmatched = wanted.filter(
      (w) => !headings.some((h) => h.text.toLowerCase() === w.toLowerCase() || h.id === w),
    );
    return {
      kind: "output",
      output: {
        content: out.join("\n"),
        omittedSegments: segments,
        warnings: [],
        details: { matchedSections: matched.map((h) => h.id), unmatchedSections: unmatched },
      },
    };
  },
  validate(_context, output): ValidationIssue[] {
    const spans: { start: number; end: number; id: string }[] = [];
    for (const segment of output.omittedSegments) {
      try {
        for (const part of parseLocations(segment.location)) {
          if (part.kind === "lines")
            spans.push({ start: part.start, end: part.end, id: segment.id });
        }
      } catch {
        // reported by the generic validator
      }
    }
    spans.sort((a, b) => a.start - b.start);
    const issues: ValidationIssue[] = [];
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1] as (typeof spans)[number];
      const cur = spans[i] as (typeof spans)[number];
      if (cur.start <= prev.end) {
        issues.push({
          code: "SECTION_OVERLAP",
          message: `Segments ${prev.id} and ${cur.id} overlap`,
        });
      }
    }
    return issues;
  },
});
