import { JSX_OPENER_SCAN_MAX_LINES } from "../constants.js";

const JSX_OPENER_TAG_PATTERN = /<[A-Za-z][\w.]*/;

// Returns the 0-based line index where the JSX opening tag that begins
// on `openerLineIndex` is closed by `>` or `/>`. Returns null when the
// line has no JSX opening tag, when the closer cannot be located within
// `JSX_OPENER_SCAN_MAX_LINES` lines, or when the opener appears to be a
// TypeScript generic (e.g. `<List<Item>`) we can't disambiguate without
// a parser.
//
// The scanner tracks brace depth and string / template literal state so
// `>` characters inside `{...}` or `"..."` aren't mistaken for the
// closer. It also skips `=>` arrow functions and `>=` comparisons,
// which are the two `>`-adjacent operator cases that show up inside
// JSX attribute expressions.
export const findJsxOpenerSpan = (lines: string[], openerLineIndex: number): number | null => {
  const openerLine = lines[openerLineIndex];
  if (openerLine === undefined) return null;
  const tagMatch = openerLine.match(JSX_OPENER_TAG_PATTERN);
  if (!tagMatch || tagMatch.index === undefined) return null;

  const startCharIndex = tagMatch.index + tagMatch[0].length;
  const lookaheadLimit = Math.min(lines.length, openerLineIndex + JSX_OPENER_SCAN_MAX_LINES);
  let braceDepth = 0;
  let stringDelimiter: '"' | "'" | "`" | null = null;

  for (let lineIndex = openerLineIndex; lineIndex < lookaheadLimit; lineIndex++) {
    const currentLine = lines[lineIndex];
    const startCharForLine = lineIndex === openerLineIndex ? startCharIndex : 0;

    for (let charIndex = startCharForLine; charIndex < currentLine.length; charIndex++) {
      const character = currentLine[charIndex];

      if (stringDelimiter !== null) {
        if (character === "\\") {
          charIndex++;
          continue;
        }
        if (character === stringDelimiter) stringDelimiter = null;
        continue;
      }

      if (character === '"' || character === "'" || character === "`") {
        stringDelimiter = character;
        continue;
      }

      if (character === "{") {
        braceDepth++;
        continue;
      }
      if (character === "}") {
        braceDepth--;
        continue;
      }
      if (character !== ">" || braceDepth !== 0) continue;

      const previousCharacter = currentLine[charIndex - 1];
      const nextCharacter = currentLine[charIndex + 1];
      if (previousCharacter === "=" || nextCharacter === "=") continue;
      return lineIndex;
    }
  }

  return null;
};
