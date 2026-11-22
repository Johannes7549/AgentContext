import * as z from "zod";

export const SEGMENT_TYPES = [
  "json_value",
  "array_items",
  "log_lines",
  "log_group",
  "duplicate_block",
  "section",
  "paragraph",
  "line_range",
  "diff_hunk",
] as const;
export const SegmentTypeSchema = z.enum(SEGMENT_TYPES);
export type SegmentType = z.infer<typeof SegmentTypeSchema>;

export const OMISSION_REASONS = [
  "excluded_by_selection",
  "not_selected",
  "array_limit",
  "depth_limit",
  "duplicate",
  "repeated_log_line",
  "below_log_level",
  "budget",
] as const;
export const OmissionReasonSchema = z.enum(OMISSION_REASONS);
export type OmissionReason = z.infer<typeof OmissionReasonSchema>;

/**
 * Canonical location string (CONTRACTS.md §6):
 *   lines:<start>-<end> | json:<normalized JSONPath> | offset:<start>-<end> | block:<index>/<location>
 * Multiple locations are joined with ";".
 */
export type SegmentLocation = string;

export const OmittedSegmentSchema = z.strictObject({
  id: z.string().regex(/^s[1-9]\d*$/, 'segment ids have the form "s<n>"'),
  type: SegmentTypeSchema,
  location: z.string().min(1),
  reason: OmissionReasonSchema,
  recoverable: z.boolean(),
  occurrences: z.exactOptional(z.number().int().positive()),
  note: z.exactOptional(z.string().max(500)),
});
export type OmittedSegment = z.infer<typeof OmittedSegmentSchema>;

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

export type ParsedLocation =
  | { kind: "lines"; start: number; end: number }
  | { kind: "json"; path: string }
  | { kind: "offset"; start: number; end: number }
  | { kind: "block"; index: number; inner: ParsedLocation };

export function linesLocation(start: number, end: number): SegmentLocation {
  assertRange(start, end, 1);
  return `lines:${start}-${end}`;
}

export function offsetLocation(start: number, end: number): SegmentLocation {
  assertRange(start, end, 0);
  return `offset:${start}-${end}`;
}

/** `path` must be an RFC 9535 normalized path beginning with "$". */
export function jsonLocation(path: string): SegmentLocation {
  if (!path.startsWith("$")) throw new RangeError("JSON locations must start with $");
  return `json:${path}`;
}

export function blockLocation(index: number, inner: SegmentLocation): SegmentLocation {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("invalid block index");
  if (inner.startsWith("block:")) throw new RangeError("block locations cannot be nested");
  return `block:${index}/${inner}`;
}

export function joinLocations(locations: readonly SegmentLocation[]): SegmentLocation {
  if (locations.length === 0) throw new RangeError("at least one location is required");
  return locations.join(";");
}

/**
 * Parse one or more ";"-joined locations. Semicolons inside quoted JSONPath
 * member names (e.g. `$['a;b']`) are not treated as separators.
 * Throws RangeError on malformed input.
 */
export function parseLocations(value: SegmentLocation): ParsedLocation[] {
  return splitLocations(value).map(parseOne);
}

function parseOne(value: string): ParsedLocation {
  const colon = value.indexOf(":");
  if (colon <= 0) throw new RangeError(`malformed location: ${truncate(value)}`);
  const kind = value.slice(0, colon);
  const rest = value.slice(colon + 1);
  switch (kind) {
    case "lines":
    case "offset": {
      const match = /^(\d+)-(\d+)$/.exec(rest);
      if (!match) throw new RangeError(`malformed ${kind} location: ${truncate(value)}`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      assertRange(start, end, kind === "lines" ? 1 : 0);
      return { kind, start, end };
    }
    case "json":
      if (!rest.startsWith("$"))
        throw new RangeError(`malformed json location: ${truncate(value)}`);
      return { kind: "json", path: rest };
    case "block": {
      const match = /^(\d+)\/(.+)$/s.exec(rest);
      if (!match?.[1] || !match[2]) {
        throw new RangeError(`malformed block location: ${truncate(value)}`);
      }
      const inner = parseOne(match[2]);
      if (inner.kind === "block") throw new RangeError("block locations cannot be nested");
      return { kind: "block", index: Number(match[1]), inner };
    }
    default:
      throw new RangeError(`unknown location kind: ${truncate(kind)}`);
  }
}

function splitLocations(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    if (inQuote) {
      current += ch;
      if (ch === "\\" && i + 1 < value.length) {
        current += value[++i];
      } else if (ch === "'") {
        inQuote = false;
      }
    } else if (ch === "'") {
      inQuote = true;
      current += ch;
    } else if (ch === ";") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (inQuote) throw new RangeError("unterminated quote in location");
  parts.push(current);
  if (parts.some((p) => p.length === 0)) throw new RangeError("empty location");
  return parts;
}

function assertRange(start: number, end: number, min: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end < start) {
    throw new RangeError(`invalid range ${start}-${end}`);
  }
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}
