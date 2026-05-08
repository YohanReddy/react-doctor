import { Box, Text } from "ink";
import { TOP_ISSUES_COMPACT_LIMIT } from "../constants.js";
import type { GroupedRule } from "../types.js";
import { colorForSeverity, symbolForSeverity } from "../utils/color-for-severity.js";

interface CompactIssueListProps {
  rules: GroupedRule[];
  excludeFirst: boolean;
  limit?: number;
}

const RULE_NAME_PAD_WIDTH = 32;

const padRight = (text: string, width: number): string => {
  if (text.length >= width) return text;
  return text + " ".repeat(width - text.length);
};

export const CompactIssueList = ({
  rules,
  excludeFirst,
  limit = TOP_ISSUES_COMPACT_LIMIT,
}: CompactIssueListProps) => {
  const displayedRules = excludeFirst ? rules.slice(1) : rules;
  const visibleRules = displayedRules.slice(0, limit);
  const remainingRulesCount = displayedRules.length - visibleRules.length;
  if (visibleRules.length === 0 && remainingRulesCount === 0) return null;
  return (
    <Box flexDirection="column">
      {visibleRules.map((rule) => {
        const severityColor = colorForSeverity(rule.severity);
        const siteCount = rule.diagnostics.length;
        return (
          <Box key={rule.ruleKey}>
            <Text color={severityColor}>
              {symbolForSeverity(rule.severity)} {padRight(rule.rule, RULE_NAME_PAD_WIDTH)}
            </Text>
            <Text color="gray">
              {siteCount} site{siteCount === 1 ? "" : "s"}
            </Text>
          </Box>
        );
      })}
      {remainingRulesCount > 0 ? (
        <Box>
          <Text color="gray">
            + {remainingRulesCount} more rule{remainingRulesCount === 1 ? "" : "s"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};
