import { Box, Text } from "ink";
import { VERY_NARROW_LAYOUT_BREAKPOINT_COLS } from "../constants.js";
import type { AppState } from "../types.js";
import { moodFromState } from "../utils/mood-from-state.js";
import { CompactIssueList } from "./compact-issue-list.js";
import { DoctorFace } from "./doctor-face.js";
import { ErrorBanner } from "./error-banner.js";
import { FocusedIssue } from "./focused-issue.js";
import { InlineProgress } from "./inline-progress.js";
import { ScanSummaryFooter } from "./scan-summary-footer.js";
import { ScoreGauge } from "./score-gauge.js";

interface DashboardViewProps {
  state: AppState;
  terminalColumns: number;
}

const computeScoreBarWidth = (terminalColumns: number): number => {
  if (terminalColumns < VERY_NARROW_LAYOUT_BREAKPOINT_COLS) return 18;
  if (terminalColumns < 90) return 24;
  return 30;
};

const NoIssuesNotice = () => (
  <Box paddingX={1} marginTop={1}>
    <Text color="green">✓ No issues detected — nice work.</Text>
  </Box>
);

export const DashboardView = ({ state, terminalColumns }: DashboardViewProps) => {
  const isInitialScan = state.scanStatus === "scanning" && state.scanCount === 0;
  const mood = moodFromState(state);
  const scoreBarWidth = computeScoreBarWidth(terminalColumns);
  const focusedRule = state.groupedRules[0];

  if (state.scanStatus === "error" && state.errorMessage) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <DoctorFace mood={mood} isAnimating={false} />
          <Box marginLeft={2} flexDirection="column" justifyContent="center">
            <ScoreGauge
              score={state.score?.score ?? null}
              label={state.score?.label ?? null}
              previousScore={null}
              barWidth={scoreBarWidth}
            />
          </Box>
        </Box>
        <ErrorBanner
          message={state.errorMessage}
          hint="Press r to retry. The lint or dead-code stage may have crashed; check the logs."
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <DoctorFace mood={mood} isAnimating={state.scanStatus === "scanning"} />
        <Box marginLeft={2} flexDirection="column" justifyContent="center">
          <ScoreGauge
            score={state.score?.score ?? null}
            label={state.score?.label ?? null}
            previousScore={state.previousScore?.score ?? null}
            barWidth={scoreBarWidth}
          />
        </Box>
      </Box>

      {isInitialScan ? (
        <Box marginTop={1} marginLeft={2}>
          <InlineProgress steps={state.steps} />
        </Box>
      ) : focusedRule ? (
        <Box flexDirection="column" marginTop={1}>
          <FocusedIssue rule={focusedRule} rootDirectory={state.rootDirectory} />
          {state.groupedRules.length > 1 ? (
            <Box marginTop={1}>
              <CompactIssueList rules={state.groupedRules} excludeFirst />
            </Box>
          ) : null}
        </Box>
      ) : state.scanStatus === "complete" ? (
        <NoIssuesNotice />
      ) : null}

      <Box marginTop={1}>
        <ScanSummaryFooter state={state} />
      </Box>
    </Box>
  );
};
