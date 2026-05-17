import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { createNodeReadFileLinesSync } from "./read-file-lines-node.js";
import { mergeAndFilterDiagnostics } from "./merge-and-filter-diagnostics.js";

interface CombineDiagnosticsInput {
  lintDiagnostics: Diagnostic[];
  directory: string;
  isDiffMode: boolean;
  userConfig: ReactDoctorConfig | null;
  readFileLinesSync?: (filePath: string) => string[] | null;
  includeEnvironmentChecks?: boolean;
  respectInlineDisables?: boolean;
  /**
   * Extra project-level diagnostics produced by async checks the caller
   * ran before invoking combineDiagnostics (e.g. dead-code analysis via
   * `checkDeadCode`). Merged with the lint and environment diagnostics
   * before suppressions and severity controls run.
   */
  extraDiagnostics?: Diagnostic[];
}

export const combineDiagnostics = (input: CombineDiagnosticsInput): Diagnostic[] => {
  const {
    lintDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    readFileLinesSync = createNodeReadFileLinesSync(directory),
    includeEnvironmentChecks = true,
    respectInlineDisables,
    extraDiagnostics = [],
  } = input;
  const environmentDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...environmentDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync, {
    respectInlineDisables,
  });
};
