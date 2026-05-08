import { Box, Text } from "ink";
import { FOCUSED_ISSUE_HELP_MAX_CHARS } from "../constants.js";
import type { GroupedRule } from "../types.js";
import { colorForSeverity, symbolForSeverity } from "../utils/color-for-severity.js";
import { readSourceSnippet } from "../utils/read-source-snippet.js";
import { toRelativePath } from "../utils/relative-path.js";
import { SourceSnippet } from "./source-snippet.js";

interface FocusedIssueProps {
  rule: GroupedRule;
  rootDirectory: string;
}

const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};

export const FocusedIssue = ({ rule, rootDirectory }: FocusedIssueProps) => {
  const severityColor = colorForSeverity(rule.severity);
  const sitesCount = rule.diagnostics.length;
  const firstSite = rule.diagnostics[0];
  const snippet =
    firstSite && firstSite.line > 0 ? readSourceSnippet(firstSite.filePath, firstSite.line) : null;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={severityColor} bold>
          {symbolForSeverity(rule.severity)} {rule.ruleKey}
        </Text>
        <Text color="gray">
          {"  "}
          {sitesCount} site{sitesCount === 1 ? "" : "s"}
        </Text>
      </Box>
      <Box marginTop={0} marginLeft={2}>
        <Text>{rule.message}</Text>
      </Box>
      {rule.help ? (
        <Box marginLeft={2}>
          <Text color="gray">→ {truncate(rule.help, FOCUSED_ISSUE_HELP_MAX_CHARS)}</Text>
        </Box>
      ) : null}
      {firstSite ? (
        <Box flexDirection="column" marginTop={1} marginLeft={4}>
          <Text color="cyan">
            {toRelativePath(firstSite.filePath, rootDirectory)}
            {firstSite.line > 0 ? `:${firstSite.line}` : ""}
          </Text>
          {snippet ? (
            <Box marginTop={0}>
              <SourceSnippet snippet={snippet} rootDirectory={rootDirectory} />
            </Box>
          ) : null}
          {sitesCount > 1 ? (
            <Box marginTop={1}>
              <Text color="gray">
                + {sitesCount - 1} more site{sitesCount - 1 === 1 ? "" : "s"}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
