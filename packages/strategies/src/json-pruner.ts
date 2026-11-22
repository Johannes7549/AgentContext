import {
  type CompressionOptions,
  jsonLocation,
  normalizedPath,
  type OmittedSegment,
  queryJsonPath,
  type ValidationIssue,
} from "@agentcontext/shared";
import { defineStrategy, type Plan, plural, SegmentIds } from "./util.js";

/** Above this many omitted children in one container, a single container-level segment is recorded. */
export const MAX_CHILD_SEGMENTS_PER_CONTAINER = 20;
/** JSON nested deeper than this is not handled (recursion safety). */
export const MAX_SUPPORTED_DEPTH = 1_000;

type Path = (string | number)[];
type JsonSelection = NonNullable<NonNullable<CompressionOptions["selection"]>["json"]>;
type Dropped = { key: string | number; reason: OmittedSegment["reason"] };

/**
 * JSON pruner (roadmap §5). Applies only with an explicit `selection.json`
 * (R5 — no field is judged irrelevant without a selection). Rules, in order:
 *
 * 1. `include` — keep only matched nodes and their ancestors; a matched node
 *    is kept whole (subject to the other rules).
 * 2. `exclude` — drop matched nodes.
 * 3. `maxDepth` — drop containers deeper than the limit (root depth = 1).
 * 4. `maxArrayItems` — keep the first N remaining items of each array.
 *
 * Output is valid JSON (pretty-printed when the original contained line
 * breaks). Array indices in the output can shift; every omission is recorded
 * against the original's normalized path and is recoverable.
 */
export const jsonPruner = defineStrategy({
  name: "json-pruner",
  version: "1.0.0",
  supports: (context, analysis) =>
    context.contentType === "json" &&
    context.json !== undefined &&
    (analysis.json?.maxDepth ?? 0) <= MAX_SUPPORTED_DEPTH,
  plan(context, _analysis, options): Plan {
    const selection = options.selection?.json;
    if (!selection || !hasRules(selection)) {
      return {
        kind: "skip",
        reason: "json-pruner requires selection.json (include, exclude, maxDepth or maxArrayItems)",
      };
    }
    const include = selection.include ? matchedPaths(context.json, selection.include) : undefined;
    if (include?.size === 0) return { kind: "skip", reason: "include paths matched nothing" };
    const exclude = selection.exclude
      ? matchedPaths(context.json, selection.exclude)
      : new Set<string>();
    if (exclude.has("$"))
      return { kind: "skip", reason: "exclude would remove the entire document" };
    const ancestors = include ? ancestorPaths(include) : new Set<string>();

    const ids = new SegmentIds();
    const segments: OmittedSegment[] = [];
    const omit = (
      path: Path,
      type: OmittedSegment["type"],
      reason: OmittedSegment["reason"],
      note: string,
    ) => {
      segments.push({
        id: ids.next(),
        type,
        location: jsonLocation(normalizedPath(path)),
        reason,
        recoverable: true,
        note,
      });
    };

    const recordDropped = (path: Path, dropped: Dropped[], total: number, isArray: boolean) => {
      if (dropped.length === 0) return;
      if (dropped.length <= MAX_CHILD_SEGMENTS_PER_CONTAINER) {
        for (const { key, reason } of dropped) {
          omit(
            [...path, key],
            "json_value",
            reason,
            reason === "depth_limit" ? "nested value beyond maxDepth" : "value omitted",
          );
        }
        return;
      }
      const reasons = new Set(dropped.map((d) => d.reason));
      omit(
        path,
        isArray ? "array_items" : "json_value",
        reasons.size === 1 ? (dropped[0] as Dropped).reason : "not_selected",
        `${dropped.length} of ${total} ${isArray ? "items" : "members"} omitted`,
      );
    };

    /** Decide whether a child is kept; returns its key's "fully included" flag. */
    const keep = (
      value: unknown,
      path: Path,
      parentDepth: number,
      parentIncluded: boolean,
    ): { kept: false; reason: OmittedSegment["reason"] } | { kept: true; included: boolean } => {
      const key = normalizedPath(path);
      if (exclude.has(key)) return { kept: false, reason: "excluded_by_selection" };
      const matched = include?.has(key) ?? false;
      if (!parentIncluded && !matched && !ancestors.has(key))
        return { kept: false, reason: "not_selected" };
      const isContainer = value !== null && typeof value === "object";
      if (isContainer && selection.maxDepth !== undefined && parentDepth + 1 > selection.maxDepth) {
        return { kept: false, reason: "depth_limit" };
      }
      return { kept: true, included: parentIncluded || matched };
    };

    const visit = (value: unknown, path: Path, depth: number, included: boolean): unknown => {
      if (value === null || typeof value !== "object") return value;

      if (Array.isArray(value)) {
        const kept: unknown[] = [];
        const dropped: Dropped[] = [];
        for (const [index, item] of value.entries()) {
          const childPath = [...path, index];
          const decision = keep(item, childPath, depth, included);
          if (decision.kept) kept.push(visit(item, childPath, depth + 1, decision.included));
          else dropped.push({ key: index, reason: decision.reason });
        }
        recordDropped(path, dropped, value.length, true);
        if (selection.maxArrayItems !== undefined && kept.length > selection.maxArrayItems) {
          const removed = kept.length - selection.maxArrayItems;
          omit(
            path,
            "array_items",
            "array_limit",
            `${plural(removed, "item")} after the first ${selection.maxArrayItems} kept items (array length ${value.length})`,
          );
          return kept.slice(0, selection.maxArrayItems);
        }
        return kept;
      }

      const record = value as Record<string, unknown>;
      const names = Object.keys(record);
      const out: Record<string, unknown> = {};
      const dropped: Dropped[] = [];
      for (const name of names) {
        const childPath = [...path, name];
        const decision = keep(record[name], childPath, depth, included);
        if (decision.kept) out[name] = visit(record[name], childPath, depth + 1, decision.included);
        else dropped.push({ key: name, reason: decision.reason });
      }
      recordDropped(path, dropped, names.length, false);
      return out;
    };

    const root = visit(context.json, [], 1, include === undefined || include.has("$"));
    if (segments.length === 0) return { kind: "skip", reason: "selection omits nothing" };
    const content = JSON.stringify(root, null, context.original.includes("\n") ? 2 : undefined);
    return { kind: "output", output: { content, omittedSegments: segments, warnings: [] } };
  },
  validate(_context, output): ValidationIssue[] {
    try {
      JSON.parse(output.content);
      return [];
    } catch {
      return [
        { code: "JSON_OUTPUT_INVALID", message: "json-pruner output does not parse as JSON" },
      ];
    }
  },
});

function hasRules(selection: JsonSelection): boolean {
  return (
    selection.include !== undefined ||
    selection.exclude !== undefined ||
    selection.maxDepth !== undefined ||
    selection.maxArrayItems !== undefined
  );
}

function matchedPaths(root: unknown, paths: string[]): Set<string> {
  const matched = new Set<string>();
  for (const path of paths) for (const match of queryJsonPath(root, path)) matched.add(match.path);
  return matched;
}

/** Every proper ancestor (normalized) of the given normalized paths, including "$". */
function ancestorPaths(paths: Set<string>): Set<string> {
  const ancestors = new Set<string>();
  for (const path of paths) {
    let rest = path;
    for (let cut = lastSegmentStart(rest); cut > 0; cut = lastSegmentStart(rest)) {
      rest = rest.slice(0, cut);
      ancestors.add(rest);
    }
  }
  return ancestors;
}

/** Index of the "[" starting the last segment of a normalized path (-1 for "$"). */
function lastSegmentStart(path: string): number {
  let inQuote = false;
  let last = -1;
  for (let i = 1; i < path.length; i++) {
    const ch = path[i];
    if (inQuote) {
      if (ch === "\\") i++;
      else if (ch === "'") inQuote = false;
    } else if (ch === "'") {
      inQuote = true;
    } else if (ch === "[") {
      last = i;
    }
  }
  return last;
}
