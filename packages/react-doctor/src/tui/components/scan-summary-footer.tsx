import { Box, Text } from "ink";
import type { AppState } from "../types.js";

interface ScanSummaryFooterProps {
  state: AppState;
}

export const ScanSummaryFooter = ({ state }: ScanSummaryFooterProps) => {
  if (state.scanStatus === "error") return null;
  if (state.scanCount === 0) return null;
  const errorCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const totalIssueCount = errorCount + warningCount;
  const affectedFileCount = new Set(state.diagnostics.map((diagnostic) => diagnostic.filePath))
    .size;
  const isStale = state.scanStatus === "scanning";
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="white" bold>
          {totalIssueCount === 0
            ? "no issues"
            : `${totalIssueCount} issue${totalIssueCount === 1 ? "" : "s"}`}
        </Text>
        {affectedFileCount > 0 ? (
          <>
            <Text color="gray"> across </Text>
            <Text color="white">
              {affectedFileCount} file{affectedFileCount === 1 ? "" : "s"}
            </Text>
          </>
        ) : null}
        {state.isWatching ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="green">● watching</Text>
          </>
        ) : null}
        {isStale ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="cyan">rescanning…</Text>
          </>
        ) : null}
        {state.isOffline ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="gray">offline</Text>
          </>
        ) : null}
      </Box>
      {state.shareUrl ? (
        <Box>
          <Text color="gray">Share your results: </Text>
          <Text color="cyan">{state.shareUrl}</Text>
        </Box>
      ) : null}
      {state.diagnosticsDirectory ? (
        <Box>
          <Text color="gray">Full diagnostics written to </Text>
          <Text color="gray">{state.diagnosticsDirectory}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
