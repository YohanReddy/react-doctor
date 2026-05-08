import { Box, Text } from "ink";
import type { CategoryBreakdown } from "../types.js";

interface CategoryBarsProps {
  breakdown: CategoryBreakdown[];
  maxBars?: number;
}

const BAR_WIDTH = 10;

const titleCase = (rawCategory: string): string => {
  if (rawCategory.length === 0) return "Uncategorized";
  return rawCategory
    .split(/[-_\s]+/)
    .map((segment) =>
      segment.length === 0 ? segment : segment[0].toUpperCase() + segment.slice(1),
    )
    .join(" ");
};

export const CategoryBars = ({ breakdown, maxBars = 6 }: CategoryBarsProps) => {
  if (breakdown.length === 0) {
    return <Text color="gray">No diagnostics yet.</Text>;
  }
  const visibleBreakdown = breakdown.slice(0, maxBars);
  const maxTotal = Math.max(...visibleBreakdown.map((entry) => entry.total), 1);
  return (
    <Box flexDirection="column">
      {visibleBreakdown.map((entry) => {
        const filledCount = Math.max(1, Math.round((entry.total / maxTotal) * BAR_WIDTH));
        const emptyCount = Math.max(0, BAR_WIDTH - filledCount);
        const hasErrors = entry.errorCount > 0;
        const barColor = hasErrors ? "red" : "yellow";
        return (
          <Box key={entry.category}>
            <Box width={20}>
              <Text color="white">{titleCase(entry.category)}</Text>
            </Box>
            <Text color={barColor}>{"█".repeat(filledCount)}</Text>
            <Text color="gray">{"░".repeat(emptyCount)}</Text>
            <Text color="gray"> </Text>
            <Text color={barColor} bold>
              {entry.total}
            </Text>
            {entry.errorCount > 0 ? (
              <>
                <Text color="gray"> </Text>
                <Text color="red">{entry.errorCount}✗</Text>
              </>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};
