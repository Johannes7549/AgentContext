import type { LineIndex } from "./domain.js";
import { lineText } from "./text.js";

export interface MarkdownHeading {
  level: number;
  text: string;
  /** 1-based line of the heading text (for setext headings: the text line). */
  line: number;
  /** GitHub-style slug, made unique with "-1", "-2", ... suffixes. */
  id: string;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/;
const NOT_PARAGRAPH = /^ {0,3}(?:[#>]|[-*+][ \t]|\d+[.)][ \t]|$)/;

/**
 * Extract ATX (`# Title`) and setext (`Title\n===`) headings, ignoring fenced
 * code blocks. Deterministic; does not interpret inline markup.
 */
export function parseMarkdownHeadings(text: string, index: LineIndex): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const slugCounts = new Map<string, number>();
  let fence: { char: string; length: number } | undefined;

  const add = (level: number, rawText: string, line: number): void => {
    const headingText = rawText.trim();
    const base = slugify(headingText) || "section";
    const seen = slugCounts.get(base) ?? 0;
    slugCounts.set(base, seen + 1);
    headings.push({ level, text: headingText, line, id: seen === 0 ? base : `${base}-${seen}` });
  };

  for (let n = 1; n <= index.count; n++) {
    const line = lineText(text, index, n).replace(/\r$/, "");
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch?.[1]?.[0] === fence.char && fenceMatch[1].length >= fence.length) {
        if (line.trim() === fenceMatch[1]) fence = undefined;
      }
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = { char: fenceMatch[1][0] as string, length: fenceMatch[1].length };
      continue;
    }

    const atx = ATX.exec(line);
    if (atx?.[1]) {
      add(atx[1].length, atx[2] ?? "", n);
      continue;
    }

    if (n < index.count && !NOT_PARAGRAPH.test(line)) {
      const next = lineText(text, index, n + 1).replace(/\r$/, "");
      const previous = n > 1 ? lineText(text, index, n - 1).trim() : "";
      if (previous === "" || n === 1) {
        if (SETEXT_H1.test(next)) {
          add(1, line, n);
          n++;
        } else if (SETEXT_H2.test(next)) {
          add(2, line, n);
          n++;
        }
      }
    }
  }
  return headings;
}

/** GitHub-style heading slug: lower-case, punctuation removed, spaces to "-". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}
