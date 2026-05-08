import { Box, Text } from "ink";
import type { GroupedRule } from "../types.js";
import { colorForSeverity, symbolForSeverity } from "../utils/color-for-severity.js";

interface DiagnosticListProps {
  rules: GroupedRule[];
  selectedIndex: number;
  viewportHeight: number;
}

const computeViewportSlice = (
  totalRules: number,
  selectedIndex: number,
  viewportHeight: number,
): { startIndex: number; endIndex: number } => {
  if (totalRules <= viewportHeight) return { startIndex: 0, endIndex: totalRules };
  const halfHeight = Math.floor(viewportHeight / 2);
  let startIndex = Math.max(0, selectedIndex - halfHeight);
  startIndex = Math.min(startIndex, totalRules - viewportHeight);
  return { startIndex, endIndex: startIndex + viewportHeight };
};

export const DiagnosticList = ({ rules, selectedIndex, viewportHeight }: DiagnosticListProps) => {
  if (rules.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="gray">No diagnostics match the current filter.</Text>
      </Box>
    );
  }
  const { startIndex, endIndex } = computeViewportSlice(
    rules.length,
    selectedIndex,
    viewportHeight,
  );
  const visibleRules = rules.slice(startIndex, endIndex);
  return (
    <Box flexDirection="column">
      {visibleRules.map((rule, visibleIndex) => {
        const ruleAbsoluteIndex = startIndex + visibleIndex;
        const isSelected = ruleAbsoluteIndex === selectedIndex;
        const severityColor = colorForSeverity(rule.severity);
        const severitySymbol = symbolForSeverity(rule.severity);
        return (
          <Box key={rule.ruleKey}>
            <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "▶ " : "  "}</Text>
            <Text color={severityColor}>{severitySymbol} </Text>
            <Text color={isSelected ? "white" : undefined} bold={isSelected}>
              {rule.ruleKey}
            </Text>
            <Text color="gray"> ({rule.diagnostics.length})</Text>
          </Box>
        );
      })}
      {endIndex < rules.length ? <Text color="gray"> ↓ {rules.length - endIndex} more</Text> : null}
    </Box>
  );
};
