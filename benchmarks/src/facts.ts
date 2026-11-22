import type { OmittedSegment } from "@agentcontext/shared";
import type { Fact } from "./scenario.js";

export interface Evidence {
  /** Everything the agent saw: optimized output plus recovered content. */
  texts: string[];
  /** Omission records returned with the optimized output. */
  segments: OmittedSegment[];
}

/** Deterministic oracle: does the evidence establish the fact? */
export function checkFact(fact: Fact, evidence: Evidence): boolean {
  switch (fact.kind) {
    case "contains":
      return evidence.texts.some((text) => text.includes(fact.text));
    case "json-record":
      return evidence.texts.some((text) => jsonRecordMatches(text, fact));
    case "occurrences":
      return (
        evidence.segments.some((s) => s.occurrences === fact.count) ||
        evidence.texts.some((text) => countOccurrences(text, fact.text) === fact.count)
      );
  }
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length))
    count++;
  return count;
}

function jsonRecordMatches(text: string, fact: Extract<Fact, { kind: "json-record" }>): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const array = (parsed as Record<string, unknown> | null)?.[fact.array];
  if (!Array.isArray(array)) return false;
  return array.some((record) => {
    if (record === null || typeof record !== "object") return false;
    const r = record as Record<string, unknown>;
    return (
      Object.entries(fact.match).every(([k, v]) => r[k] === v) &&
      Object.entries(fact.expect).every(([k, v]) => r[k] === v)
    );
  });
}
