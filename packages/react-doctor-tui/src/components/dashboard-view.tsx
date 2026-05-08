import { Box, Text, useWindowSize } from "ink";
import { NARROW_SCREEN_THRESHOLD_COLS } from "../constants.js";
import type { AppState } from "../types.js";
import { computeCategoryBreakdown } from "../utils/category-breakdown.js";
import { formatElapsed } from "../utils/format-elapsed.js";
import { moodFromState } from "../utils/mood-from-state.js";
import { CategoryBars } from "./category-bars.js";
import { DoctorFace } from "./doctor-face.js";
import { ProgressChecklist } from "./progress-checklist.js";
import { ScoreGauge } from "./score-gauge.js";

interface DashboardViewProps {
  state: AppState;
}

export const DashboardView = ({ state }: DashboardViewProps) => {
  const { columns } = useWindowSize();
  const isNarrowScreen = columns < NARROW_SCREEN_THRESHOLD_COLS;
  const isScanning = state.scanStatus === "scanning";
  const mood = moodFromState(state);
  const errorCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const affectedFileCount = new Set(state.diagnostics.map((diagnostic) => diagnostic.filePath))
    .size;
  const categoryBreakdown = computeCategoryBreakdown(state.diagnostics);
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box>
        <DoctorFace mood={mood} isAnimating={isScanning} />
        <Box marginLeft={2} flexDirection="column">
          <ScoreGauge
            score={state.score?.score ?? null}
            label={state.score?.label ?? null}
            previousScore={state.previousScore?.score ?? null}
            isOffline={state.isOffline}
            history={state.scoreHistory}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={errorCount > 0 ? "red" : "gray"} bold={errorCount > 0}>
          ✗ {errorCount} error{errorCount === 1 ? "" : "s"}
        </Text>
        <Text color="gray"> </Text>
        <Text color={warningCount > 0 ? "yellow" : "gray"} bold={warningCount > 0}>
          ⚠ {warningCount} warning{warningCount === 1 ? "" : "s"}
        </Text>
        <Text color="gray"> </Text>
        <Text color="gray">
          across {affectedFileCount} file{affectedFileCount === 1 ? "" : "s"}
        </Text>
        {state.lastScanElapsedMs !== null ? (
          <>
            <Text color="gray"> </Text>
            <Text color="gray">in {formatElapsed(state.lastScanElapsedMs)}</Text>
          </>
        ) : null}
        {state.scanCount > 0 ? (
          <>
            <Text color="gray"> </Text>
            <Text color="gray">scan #{state.scanCount}</Text>
          </>
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Box flexDirection="column" width={isNarrowScreen ? "100%" : "50%"}>
          <Text color="gray" bold>
            Progress
          </Text>
          <Box marginTop={0}>
            <ProgressChecklist
              steps={state.steps}
              compact={state.scanStatus === "complete" || state.scanStatus === "idle"}
            />
          </Box>
        </Box>
        {isNarrowScreen ? null : (
          <Box flexDirection="column" width="50%">
            <Text color="gray" bold>
              Categories
            </Text>
            <Box marginTop={0}>
              <CategoryBars breakdown={categoryBreakdown} />
            </Box>
          </Box>
        )}
      </Box>

      {state.diagnosticsOutputPath ? (
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text color="gray">
            Full diagnostics written to {state.diagnosticsOutputPath}
          </Text>
          {state.shareUrl ? (
            <Text color="gray">
              Share your results: <Text color="cyan">{state.shareUrl}</Text>
            </Text>
          ) : null}
        </Box>
      ) : null}

      {state.errorMessage ? (
        <Box marginTop={1}>
          <Text color="red">✗ {state.errorMessage}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
