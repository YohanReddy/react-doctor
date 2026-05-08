import { Box, Text } from "ink";
import { useMemo } from "react";
import type { GroupedRule } from "../types.js";
import { colorForSeverity, symbolForSeverity } from "../utils/color-for-severity.js";
import { readSourceSnippet } from "../utils/read-source-snippet.js";
import { toRelativePath } from "../utils/relative-path.js";
import { SourceSnippet } from "./source-snippet.js";

interface DiagnosticDetailProps {
  rule: GroupedRule | undefined;
  selectedSiteIndex: number;
  rootDirectory: string;
}

export const DiagnosticDetail = ({
  rule,
  selectedSiteIndex,
  rootDirectory,
}: DiagnosticDetailProps) => {
  const selectedDiagnostic = rule?.diagnostics[selectedSiteIndex];
  const snippet = useMemo(() => {
    if (!selectedDiagnostic || selectedDiagnostic.line <= 0) return null;
    return readSourceSnippet(selectedDiagnostic.filePath, selectedDiagnostic.line);
  }, [selectedDiagnostic]);

  if (!rule) {
    return (
      <Box paddingX={1}>
        <Text color="gray">Select a rule to inspect its diagnostics.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colorForSeverity(rule.severity)}>{symbolForSeverity(rule.severity)} </Text>
        <Text bold>{rule.ruleKey}</Text>
        <Text color="gray"> </Text>
        <Text color="gray">
          {rule.severity} · {rule.category || "uncategorized"}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>{rule.message}</Text>
      </Box>
      {rule.help ? (
        <Box marginTop={1}>
          <Text color="gray">→ {rule.help}</Text>
        </Box>
      ) : null}
      {selectedDiagnostic ? (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="gray">site </Text>
            <Text color="white" bold>
              {selectedSiteIndex + 1}
            </Text>
            <Text color="gray"> / {rule.diagnostics.length} </Text>
            <Text color="cyan">
              {toRelativePath(selectedDiagnostic.filePath, rootDirectory)}
              {selectedDiagnostic.line > 0 ? `:${selectedDiagnostic.line}` : ""}
            </Text>
          </Box>
          {snippet ? (
            <Box marginTop={1}>
              <SourceSnippet snippet={snippet} rootDirectory={rootDirectory} />
            </Box>
          ) : null}
          {selectedDiagnostic.suppressionHint ? (
            <Box marginTop={1}>
              <Text color="yellow">↳ {selectedDiagnostic.suppressionHint}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
