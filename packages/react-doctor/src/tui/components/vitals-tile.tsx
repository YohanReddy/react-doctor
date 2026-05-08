import { Box, Text } from "ink";
import type { AppState } from "../types.js";
import { formatElapsed } from "../utils/format-elapsed.js";
import { Tile } from "./tile.js";

interface VitalsTileProps {
  state: AppState;
}

const accentForState = (state: AppState): string => {
  const errorCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  if (errorCount > 0) return "red";
  if (state.diagnostics.length > 0) return "yellow";
  return "green";
};

export const VitalsTile = ({ state }: VitalsTileProps) => {
  const errorCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const affectedFileCount = new Set(state.diagnostics.map((diagnostic) => diagnostic.filePath))
    .size;
  return (
    <Tile title="Vitals" accent={accentForState(state)} flexGrow={1}>
      <Box flexDirection="column">
        <Box>
          <Text color={errorCount > 0 ? "red" : "gray"} bold={errorCount > 0}>
            ✗ {errorCount}
          </Text>
          <Text color="gray">{` error${errorCount === 1 ? "" : "s"}`}</Text>
        </Box>
        <Box>
          <Text color={warningCount > 0 ? "yellow" : "gray"} bold={warningCount > 0}>
            ⚠ {warningCount}
          </Text>
          <Text color="gray">{` warning${warningCount === 1 ? "" : "s"}`}</Text>
        </Box>
        <Box>
          <Text color="white" bold>
            {affectedFileCount}
          </Text>
          <Text color="gray">{` file${affectedFileCount === 1 ? "" : "s"} affected`}</Text>
        </Box>
        <Box>
          <Text color="gray">scan </Text>
          <Text color="white" bold>
            #{state.scanCount}
          </Text>
          {state.lastScanElapsedMs !== null ? (
            <>
              <Text color="gray"> · </Text>
              <Text color="gray">{formatElapsed(state.lastScanElapsedMs)}</Text>
            </>
          ) : null}
        </Box>
      </Box>
    </Tile>
  );
};
