import { Box, Text } from "ink";
import { DIAGNOSTIC_LIST_VIEWPORT_ROWS, VERY_NARROW_LAYOUT_BREAKPOINT_COLS } from "../constants.js";
import type { AppState } from "../types.js";
import { DiagnosticDetail } from "./diagnostic-detail.js";
import { DiagnosticList } from "./diagnostic-list.js";

interface ReviewViewProps {
  state: AppState;
  terminalColumns: number;
  terminalRows: number;
}

const HEADER_AND_FOOTER_RESERVED_ROWS = 8;

export const ReviewView = ({ state, terminalColumns, terminalRows }: ReviewViewProps) => {
  const selectedRule = state.groupedRules[state.selectedRuleIndex];
  const isNarrow = terminalColumns < VERY_NARROW_LAYOUT_BREAKPOINT_COLS;
  const viewportHeight = Math.max(
    4,
    Math.min(DIAGNOSTIC_LIST_VIEWPORT_ROWS, terminalRows - HEADER_AND_FOOTER_RESERVED_ROWS),
  );
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box>
        <Text color="gray">Diagnostics</Text>
        <Text color="gray"> </Text>
        <Text color="white" bold>
          {state.filteredDiagnostics.length}
        </Text>
        <Text color="gray"> shown</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">{state.diagnostics.length} total</Text>
        {state.filterText.length > 0 ? (
          <>
            <Text color="gray"> · filter: </Text>
            <Text color="cyan">{state.filterText}</Text>
          </>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection={isNarrow ? "column" : "row"}>
        <Box flexDirection="column" width={isNarrow ? "100%" : "42%"}>
          <DiagnosticList
            rules={state.groupedRules}
            selectedIndex={state.selectedRuleIndex}
            viewportHeight={viewportHeight}
          />
        </Box>
        <Box
          flexDirection="column"
          width={isNarrow ? "100%" : "58%"}
          paddingLeft={isNarrow ? 0 : 1}
        >
          <DiagnosticDetail
            rule={selectedRule}
            selectedSiteIndex={state.selectedSiteIndex}
            rootDirectory={state.rootDirectory}
          />
        </Box>
      </Box>
    </Box>
  );
};
