import { Box, Text } from "ink";
import type { SourceSnippetResult } from "../utils/read-source-snippet.js";

interface SourceSnippetProps {
  snippet: SourceSnippetResult;
  rootDirectory: string;
}

const padLineNumber = (lineNumber: number, maxDigits: number): string =>
  String(lineNumber).padStart(maxDigits);

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};

export const SourceSnippet = ({ snippet }: SourceSnippetProps) => {
  if (snippet.errorMessage) {
    return (
      <Box>
        <Text color="gray">[unable to read snippet: {snippet.errorMessage}]</Text>
      </Box>
    );
  }
  if (snippet.lines.length === 0) {
    return (
      <Box>
        <Text color="gray">[no snippet available]</Text>
      </Box>
    );
  }
  const maxDigits = String(snippet.endLine).length;
  return (
    <Box flexDirection="column">
      {snippet.lines.map((line) => {
        const isHighlighted = line.isHighlighted;
        const indicator = isHighlighted ? "▸" : " ";
        return (
          <Box key={line.lineNumber}>
            <Text color={isHighlighted ? "red" : "gray"}>{indicator}</Text>
            <Text color="gray"> {padLineNumber(line.lineNumber, maxDigits)} │ </Text>
            <Text color={isHighlighted ? "white" : "gray"} bold={isHighlighted}>
              {truncateText(line.text, 80)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
