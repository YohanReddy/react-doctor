import { Box, Text } from "ink";
import { DIAGNOSTIC_LIST_VIEWPORT_ROWS, REVIEW_STACK_BREAKPOINT_COLS } from "../constants.js";
import type { AppState } from "../types.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticList } from "./diagnostic-list.js";

interface ReviewViewProps {
  state: AppState;
  terminalColumns: number;
  terminalRows: number;
}

const HEADER_AND_FOOTER_RESERVED_ROWS = 8;

const HORIZONTAL_PADDING_COLS = 2;
const PANE_GUTTER_COLS = 2;

const computePaneWidths = (
  terminalColumns: number,
  isStacked: boolean,
): { listWidth: number; detailWidth: number } => {
  const usableWidth = Math.max(20, terminalColumns - HORIZONTAL_PADDING_COLS);
  if (isStacked) {
    return { listWidth: usableWidth, detailWidth: usableWidth };
  }
  const splitWidth = usableWidth - PANE_GUTTER_COLS;
  const listWidth = Math.max(20, Math.floor(splitWidth * 0.4));
  const detailWidth = Math.max(30, splitWidth - listWidth);
  return { listWidth, detailWidth };
};

export const ReviewView = ({ state, terminalColumns, terminalRows }: ReviewViewProps) => {
  const selectedRule = state.groupedRules[state.selectedRuleIndex];
  const isStacked = terminalColumns < REVIEW_STACK_BREAKPOINT_COLS;
  const { listWidth, detailWidth } = computePaneWidths(terminalColumns, isStacked);
  const viewportHeight = Math.max(
    4,
    Math.min(DIAGNOSTIC_LIST_VIEWPORT_ROWS, terminalRows - HEADER_AND_FOOTER_RESERVED_ROWS),
  );
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="gray">Diagnostics</Text>
        <Text color="gray"> </Text>
        <Text color="white" bold>
          {state.matchedDiagnostics.length}
        </Text>
        <Text color="gray"> shown</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{state.diagnostics.length} total</Text>
        {state.searchText.length > 0 ? (
          <>
            <Text color="gray"> · search: </Text>
            <Text color="cyan">{state.searchText}</Text>
          </>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection={isStacked ? "column" : "row"}>
        <Box flexDirection="column" width={isStacked ? "100%" : listWidth} flexShrink={0}>
          <DiagnosticList
            rules={state.groupedRules}
            selectedIndex={state.selectedRuleIndex}
            viewportHeight={viewportHeight}
            paneWidth={listWidth}
          />
        </Box>
        <Box
          flexDirection="column"
          width={isStacked ? "100%" : detailWidth}
          flexShrink={0}
          paddingLeft={isStacked ? 0 : 1}
          marginTop={isStacked ? 1 : 0}
        >
          <DiagnosticDetail
            rule={selectedRule}
            selectedSiteIndex={state.selectedSiteIndex}
            rootDirectory={state.rootDirectory}
            paneWidth={detailWidth}
          />
        </Box>
      </Box>
    </Box>
  );
};
