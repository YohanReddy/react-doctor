import type {
  DiffInfo,
  JsonReport,
  JsonReportDiffInfo,
  JsonReportMode,
  JsonReportProjectEntry,
  InspectResult,
} from "@react-doctor/types";
import { summarizeDiagnostics } from "./summarize-diagnostics.js";

interface BuildJsonReportInput {
  version: string;
  directory: string;
  mode: JsonReportMode;
  diff: DiffInfo | null;
  scans: Array<{ directory: string; result: InspectResult }>;
  totalElapsedMilliseconds: number;
}

const toJsonDiff = (diff: DiffInfo | null): JsonReportDiffInfo | null => {
  if (!diff) return null;
  return {
    baseBranch: diff.baseBranch,
    currentBranch: diff.currentBranch,
    changedFileCount: diff.changedFiles.length,
    isCurrentChanges: Boolean(diff.isCurrentChanges),
  };
};

export const findWorstScoredProject = (
  projects: JsonReportProjectEntry[],
): JsonReportProjectEntry | null => {
  let worst: JsonReportProjectEntry | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const project of projects) {
    const score = project.score?.score;
    if (typeof score !== "number") continue;
    if (score < worstScore) {
      worstScore = score;
      worst = project;
    }
  }
  return worst;
};

export const buildJsonReport = (input: BuildJsonReportInput): JsonReport => {
  const projects: JsonReportProjectEntry[] = input.scans.map(({ directory, result }) => ({
    directory,
    project: result.project,
    diagnostics: result.diagnostics,
    score: result.score,
    skippedChecks: result.skippedChecks,
    ...(result.skippedCheckReasons ? { skippedCheckReasons: result.skippedCheckReasons } : {}),
    elapsedMilliseconds: result.elapsedMilliseconds,
    ...(result.baselineDiagnostics !== undefined
      ? { baselineDiagnostics: result.baselineDiagnostics }
      : {}),
    ...(result.diagnosticsHiddenByTouchedLines !== undefined &&
    result.diagnosticsHiddenByTouchedLines > 0
      ? { diagnosticsHiddenByTouchedLines: result.diagnosticsHiddenByTouchedLines }
      : {}),
  }));

  const flattenedDiagnostics = projects.flatMap((entry) => entry.diagnostics);
  const worstScoredProject = findWorstScoredProject(projects);

  const baselineDiagnosticCount = projects.reduce(
    (total, project) => total + (project.baselineDiagnostics?.length ?? 0),
    0,
  );

  const summary = summarizeDiagnostics(
    flattenedDiagnostics,
    worstScoredProject?.score?.score ?? null,
    worstScoredProject?.score?.label ?? null,
    baselineDiagnosticCount,
  );

  return {
    schemaVersion: 1,
    version: input.version,
    ok: true,
    directory: input.directory,
    mode: input.mode,
    diff: toJsonDiff(input.diff),
    projects,
    diagnostics: flattenedDiagnostics,
    summary,
    elapsedMilliseconds: input.totalElapsedMilliseconds,
    error: null,
  };
};
