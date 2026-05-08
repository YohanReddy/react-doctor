import { Box, Text } from "ink";
import type { AppState } from "../types.js";
import { formatElapsed } from "../utils/format-elapsed.js";

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
  const elapsed = state.lastScanElapsedMs !== null ? formatElapsed(state.lastScanElapsedMs) : "—";
  const isStale = state.scanStatus === "scanning";
  return (
    <Box paddingX={1}>
      <Text color="gray">Last scan </Text>
      <Text color="white">{elapsed}</Text>
      <Text color="gray"> · </Text>
      <Text color="white">
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
  );
};
