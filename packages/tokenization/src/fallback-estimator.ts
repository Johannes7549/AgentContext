import type { Tokenizer } from "@agentcontext/shared";

/**
 * Deterministic, dependency-free token **estimator** (ADR-0003). Never exact.
 *
 * The text is split into pieces, scanned left to right (first match wins):
 *
 * | Piece                                         | Estimated tokens                    |
 * |-----------------------------------------------|-------------------------------------|
 * | ASCII word run `[A-Za-z0-9_]+`                | ceil(length / 4)                    |
 * | Whitespace run containing a line break        | 1                                   |
 * | Other whitespace run                          | 0 if length 1, else ceil(length / 4) |
 * | CJK character (Han, Hiragana, Katakana, Hangul) | 1 per character                   |
 * | Other letter/number/mark run                  | ceil(length / 2) (code points)      |
 * | Any other character, BMP                      | 1                                   |
 * | Any other character, astral (e.g. emoji)      | 2                                   |
 *
 * The heuristic approximates common BPE tokenizers for English prose, code,
 * logs and JSON. Changing the formula requires bumping `version`, because
 * stored metrics record the tokenizer version.
 */
export class FallbackEstimator implements Tokenizer {
  readonly id = "fallback-estimator";
  readonly version = "1.0.0";
  readonly isExact = false;

  countTokens(text: string): number {
    let total = 0;
    PIECE.lastIndex = 0;
    for (let match = PIECE.exec(text); match !== null; match = PIECE.exec(text)) {
      const [, word, space, cjk, other, single] = match;
      if (word !== undefined) {
        total += Math.ceil(word.length / 4);
      } else if (space !== undefined) {
        if (space.includes("\n")) total += 1;
        else if (space.length > 1) total += Math.ceil(space.length / 4);
      } else if (cjk !== undefined) {
        total += 1;
      } else if (other !== undefined) {
        total += Math.ceil(codePointLength(other) / 2);
      } else if (single !== undefined) {
        total += (single.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
      }
    }
    return total;
  }
}

const PIECE = new RegExp(
  [
    "([A-Za-z0-9_]+)",
    "(\\s+)",
    "([\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}])",
    "((?:(?![A-Za-z0-9_])[\\p{L}\\p{N}\\p{M}])+)",
    "([^])",
  ].join("|"),
  "gu",
);

function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}
