import { Box } from "ink";
import { NARROW_LAYOUT_BREAKPOINT_COLS, VERY_NARROW_LAYOUT_BREAKPOINT_COLS } from "../constants.js";
import type { AppState } from "../types.js";
import { computeCategoryBreakdown } from "../utils/category-breakdown.js";
import { CategoriesTile } from "./categories-tile.js";
import { ErrorBanner } from "./error-banner.js";
import { HealthTile } from "./health-tile.js";
import { ProgressTile } from "./progress-tile.js";
import { ScanSummaryFooter } from "./scan-summary-footer.js";
import { TopIssuesTile } from "./top-issues-tile.js";
import { VitalsTile } from "./vitals-tile.js";

interface DashboardViewProps {
  state: AppState;
  terminalColumns: number;
}

const computeScoreBarWidth = (terminalColumns: number): number => {
  if (terminalColumns < VERY_NARROW_LAYOUT_BREAKPOINT_COLS) return 18;
  if (terminalColumns < NARROW_LAYOUT_BREAKPOINT_COLS) return 22;
  return 28;
};

const computeCategoriesMaxBars = (terminalRowsAvailable: number): number => {
  if (terminalRowsAvailable < 8) return 3;
  if (terminalRowsAvailable < 14) return 4;
  return 6;
};

export const DashboardView = ({ state, terminalColumns }: DashboardViewProps) => {
  const isInitialScan = state.scanStatus === "scanning" && state.scanCount === 0;
  const isVeryNarrow = terminalColumns < VERY_NARROW_LAYOUT_BREAKPOINT_COLS;
  const shouldStack = terminalColumns < NARROW_LAYOUT_BREAKPOINT_COLS;
  const scoreBarWidth = computeScoreBarWidth(terminalColumns);
  const showScoreHistory = !isVeryNarrow && state.scoreHistory.length > 1;
  const categoryBreakdown = computeCategoryBreakdown(state.diagnostics);
  const categoriesMaxBars = computeCategoriesMaxBars(8);

  if (state.scanStatus === "error" && state.errorMessage) {
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <ErrorBanner
          message={state.errorMessage}
          hint="Press r to retry, q to quit. The lint or dead-code stage may have crashed; check the logs."
        />
        <Box flexDirection={shouldStack ? "column" : "row"}>
          <HealthTile state={state} scoreBarWidth={scoreBarWidth} showHistory={false} />
          {shouldStack ? null : <Box width={1} />}
          <VitalsTile state={state} />
        </Box>
      </Box>
    );
  }

  if (isInitialScan) {
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Box flexDirection={shouldStack ? "column" : "row"}>
          <HealthTile state={state} scoreBarWidth={scoreBarWidth} showHistory={false} />
          {shouldStack ? null : <Box width={1} />}
          <ProgressTile steps={state.steps} />
        </Box>
        <ScanSummaryFooter state={state} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection={shouldStack ? "column" : "row"}>
        <HealthTile state={state} scoreBarWidth={scoreBarWidth} showHistory={showScoreHistory} />
        {shouldStack ? null : <Box width={1} />}
        <VitalsTile state={state} />
      </Box>
      <Box flexDirection={shouldStack ? "column" : "row"} marginTop={1}>
        <TopIssuesTile rules={state.groupedRules} />
        {shouldStack ? null : <Box width={1} />}
        <CategoriesTile breakdown={categoryBreakdown} maxBars={categoriesMaxBars} />
      </Box>
      <Box marginTop={1}>
        <ScanSummaryFooter state={state} />
      </Box>
    </Box>
  );
};
