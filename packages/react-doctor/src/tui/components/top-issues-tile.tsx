import { Box, Text } from "ink";
import { TOP_ISSUES_LIMIT } from "../constants.js";
import type { GroupedRule } from "../types.js";
import { colorForSeverity, symbolForSeverity } from "../utils/color-for-severity.js";
import { Tile } from "./tile.js";

interface TopIssuesTileProps {
  rules: GroupedRule[];
  limit?: number;
}

const truncateMessage = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};

export const TopIssuesTile = ({ rules, limit = TOP_ISSUES_LIMIT }: TopIssuesTileProps) => {
  const visibleRules = rules.slice(0, limit);
  return (
    <Tile title="Top issues" accent="white" flexGrow={1}>
      {visibleRules.length === 0 ? (
        <Text color="gray">No issues detected.</Text>
      ) : (
        <Box flexDirection="column">
          {visibleRules.map((rule) => {
            const severityColor = colorForSeverity(rule.severity);
            return (
              <Box key={rule.ruleKey}>
                <Text color={severityColor}>{symbolForSeverity(rule.severity)} </Text>
                <Text color="white">{truncateMessage(rule.rule, 28)}</Text>
                <Text color="gray"> ({rule.diagnostics.length})</Text>
              </Box>
            );
          })}
          {rules.length > visibleRules.length ? (
            <Text color="gray"> +{rules.length - visibleRules.length} more rules</Text>
          ) : null}
        </Box>
      )}
    </Tile>
  );
};
