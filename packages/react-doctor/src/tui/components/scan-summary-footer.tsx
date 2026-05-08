import { Box, Text } from "ink";
import type { AppState } from "../types.js";
import { formatElapsed } from "../utils/format-elapsed.js";

interface ScanSummaryFooterProps {
  state: AppState;
}

export const ScanSummaryFooter = ({ state }: ScanSummaryFooterProps) => {
  if (state.scanStatus === "scanning" && state.scanCount === 0) {
    return null;
  }
  if (state.scanStatus === "error") {
    return null;
  }
  const errorCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const totalIssueCount = errorCount + warningCount;
  const elapsed = state.lastScanElapsedMs !== null ? formatElapsed(state.lastScanElapsedMs) : "—";
  const overallSymbol = errorCount > 0 ? "✗" : totalIssueCount > 0 ? "⚠" : "✓";
  const overallColor = errorCount > 0 ? "red" : totalIssueCount > 0 ? "yellow" : "green";
  const issueLabel =
    totalIssueCount === 0
      ? "no issues"
      : `${totalIssueCount} issue${totalIssueCount === 1 ? "" : "s"}`;
  const isStale = state.scanStatus === "scanning" && state.scanCount > 0;
  return (
    <Box paddingX={1}>
      <Text color={overallColor} bold>
        {overallSymbol}{" "}
      </Text>
      <Text color="gray">Last scan </Text>
      <Text color="white">{elapsed}</Text>
      <Text color="gray"> · </Text>
      <Text color="white">{issueLabel}</Text>
      {state.isOffline ? (
        <>
          <Text color="gray"> · </Text>
          <Text color="gray">offline</Text>
        </>
      ) : null}
      {isStale ? (
        <>
          <Text color="gray"> · </Text>
          <Text color="cyan">rescanning…</Text>
        </>
      ) : null}
    </Box>
  );
};
