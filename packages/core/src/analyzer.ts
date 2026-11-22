import {
  type ContentAnalysis,
  detectLogLevel,
  isErrorLine,
  type LogLevel,
  lineText,
  type NormalizedContext,
  parseMarkdownHeadings,
  sha256Hex,
  type Tokenizer,
  utf8ByteLength,
} from "@agentcontext/shared";
import { countTokens } from "@agentcontext/tokenization";
import { detectContentType } from "./detector.js";

/** Maximum number of duplicate groups reported (largest first by occurrences). */
export const MAX_DUPLICATE_GROUPS = 1_000;

/**
 * Describe normalized content (CONTRACTS.md §4). Pure apart from token counting;
 * deterministic for identical input and tokenizer.
 *
 * Duplicate units: paragraphs (blank-line separated) for text/markdown, lines
 * otherwise. Units are compared after removing trailing whitespace; blank units
 * are ignored.
 */
export async function analyze(
  context: NormalizedContext,
  tokenizer: Tokenizer,
): Promise<ContentAnalysis> {
  const { original, lines } = context;
  const lineTexts = Array.from({ length: lines.count }, (_, i) => lineText(original, lines, i + 1));

  const analysis: ContentAnalysis = {
    contentType: context.contentType,
    contentTypeSource: context.contentTypeSource,
    detectionConfidence:
      context.contentTypeSource === "caller" || context.contentType === "mcp_content"
        ? "high"
        : detectContentType(original).confidence,
    sizeBytes: utf8ByteLength(original),
    lineCount: lines.count,
    tokens: await countTokens(tokenizer, original),
    duplicateBlocks: findDuplicates(
      lineTexts,
      context.contentType === "text" || context.contentType === "markdown" ? "paragraph" : "line",
    ),
  };

  if (context.contentType === "logs") {
    const levels: Partial<Record<LogLevel, number>> = {};
    const errorLines: number[] = [];
    lineTexts.forEach((line, i) => {
      const level = detectLogLevel(line);
      if (level) levels[level] = (levels[level] ?? 0) + 1;
      if (isErrorLine(line)) errorLines.push(i + 1);
    });
    analysis.logLevels = levels;
    analysis.errorLines = errorLines;
  }

  if (context.contentType === "markdown") {
    analysis.headings = parseMarkdownHeadings(original, lines);
  }

  if (context.json !== undefined) {
    analysis.json = jsonStats(context.json);
  }

  return analysis;
}

function findDuplicates(
  lineTexts: string[],
  unit: "line" | "paragraph",
): ContentAnalysis["duplicateBlocks"] {
  const units: { text: string; firstLine: number }[] = [];
  if (unit === "line") {
    lineTexts.forEach((line, i) => {
      units.push({ text: line.trimEnd(), firstLine: i + 1 });
    });
  } else {
    let current: string[] = [];
    let startLine = 0;
    lineTexts.forEach((line, i) => {
      if (line.trim() === "") {
        if (current.length) units.push({ text: current.join("\n"), firstLine: startLine });
        current = [];
      } else {
        if (!current.length) startLine = i + 1;
        current.push(line.trimEnd());
      }
    });
    if (current.length) units.push({ text: current.join("\n"), firstLine: startLine });
  }

  const groups = new Map<string, { hash: string; occurrences: number; firstLine: number }>();
  for (const { text, firstLine } of units) {
    if (text.trim() === "") continue;
    const hash = sha256Hex(text);
    const group = groups.get(hash);
    if (group) group.occurrences++;
    else groups.set(hash, { hash, occurrences: 1, firstLine });
  }

  return [...groups.values()]
    .filter((group) => group.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences || a.firstLine - b.firstLine)
    .slice(0, MAX_DUPLICATE_GROUPS)
    .sort((a, b) => a.firstLine - b.firstLine);
}

/** Iterative (stack-safe) JSON statistics. Depth of a scalar root is 0. */
function jsonStats(root: unknown): NonNullable<ContentAnalysis["json"]> {
  let maxDepth = 0;
  let arrayCount = 0;
  let largestArrayLength = 0;
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number };
    if (value === null || typeof value !== "object") continue;
    maxDepth = Math.max(maxDepth, depth + 1);
    if (Array.isArray(value)) {
      arrayCount++;
      largestArrayLength = Math.max(largestArrayLength, value.length);
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
    } else {
      for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
    }
  }
  return { maxDepth, arrayCount, largestArrayLength };
}
