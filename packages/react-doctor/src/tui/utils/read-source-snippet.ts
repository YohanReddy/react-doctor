import fs from "node:fs";
import { SOURCE_SNIPPET_CONTEXT_LINES } from "../constants.js";

export interface SourceSnippetLine {
  lineNumber: number;
  text: string;
  isHighlighted: boolean;
}

export interface SourceSnippetResult {
  filePath: string;
  startLine: number;
  endLine: number;
  lines: SourceSnippetLine[];
  errorMessage?: string;
}

export const readSourceSnippet = (
  filePath: string,
  highlightedLine: number,
  contextLines: number = SOURCE_SNIPPET_CONTEXT_LINES,
): SourceSnippetResult => {
  try {
    const fileContents = fs.readFileSync(filePath, "utf-8");
    const fileLines = fileContents.split("\n");
    const startLine = Math.max(1, highlightedLine - contextLines);
    const endLine = Math.min(fileLines.length, highlightedLine + contextLines);
    const lines: SourceSnippetLine[] = [];
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      lines.push({
        lineNumber,
        text: fileLines[lineNumber - 1] ?? "",
        isHighlighted: lineNumber === highlightedLine,
      });
    }
    return { filePath, startLine, endLine, lines };
  } catch (readError) {
    return {
      filePath,
      startLine: 0,
      endLine: 0,
      lines: [],
      errorMessage: (readError as Error).message,
    };
  }
};
