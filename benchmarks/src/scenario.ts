import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompressionOptions, ContentType, RetrievalSelector } from "@agentcontext/shared";

/**
 * A benchmark scenario: an input, the options an agent would use for the
 * task, the facts a correct answer needs (ground truth), and the retrieval
 * calls an agent would make for facts it expects to be omitted.
 */
export interface Scenario {
  id: string;
  title: string;
  /** The task an agent is asked to perform on this input. */
  task: string;
  /** Input file name inside the dataset directory. */
  input: string;
  contentType?: ContentType;
  options: CompressionOptions;
  facts: Fact[];
  /** Retrieval calls made after optimization (selectors only; contextId is filled in). */
  recovery: { selector?: RetrievalSelector; contextLines?: number }[];
}

export type Fact =
  /** The evidence must contain this exact text. */
  | { id: string; kind: "contains"; text: string }
  /** Some JSON document in the evidence has, under `array`, a record matching `match` with values `expect`. */
  | {
      id: string;
      kind: "json-record";
      array: string;
      match: Record<string, unknown>;
      expect: Record<string, unknown>;
    }
  /** Some omitted segment (or the input itself) reports exactly this many occurrences of `text`. */
  | { id: string; kind: "occurrences"; text: string; count: number };

export const DATASETS_DIR = fileURLToPath(new URL("../datasets/", import.meta.url));

export const SCENARIO_IDS = [
  "terminal-large",
  "terminal-large-levels",
  "api-responses",
  "duplicate-heavy",
  "documentation",
  "source-code",
  "source-diff",
] as const;

export function loadScenario(
  id: string,
  root = DATASETS_DIR,
): { scenario: Scenario; input: string } {
  const scenario = JSON.parse(readFileSync(join(root, id, "scenario.json"), "utf8")) as Scenario;
  const input = readFileSync(join(root, id, scenario.input), "utf8");
  return { scenario, input };
}
