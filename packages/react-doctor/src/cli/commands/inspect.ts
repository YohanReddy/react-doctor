import fs, { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildBaselineFile,
  buildJsonReport,
  filterDiagnosticsForSurface,
  filterSourceFiles,
  getDiffInfo,
  getTouchedLines,
  highlighter,
  loadConfigWithSource,
  logger,
  resolveBaselineSettings,
  resolveConfigRootDir,
  toRelativePath,
  writeBaselineFile,
} from "@react-doctor/core";
import type { TouchedLinesByFile } from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import type { Diagnostic, DiffInfo, InspectResult, JsonReport } from "@react-doctor/types";
import { buildPrCommentMarkdown } from "../utils/build-pr-comment-markdown.js";
import { STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { handleError } from "../utils/handle-error.js";
import { isCiEnvironment } from "../utils/is-ci-environment.js";
import {
  enableJsonMode,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
  writeJsonReport,
} from "../utils/json-mode.js";
import { printAnnotations } from "../utils/print-annotations.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveConcurrency } from "../utils/resolve-concurrency.js";
import { resolveDiffMode } from "../utils/resolve-diff-mode.js";
import { resolveEffectiveDiff } from "../utils/resolve-effective-diff.js";
import { resolveFailOnLevel } from "../utils/resolve-fail-on-level.js";
import { runExplain } from "../utils/run-explain.js";
import { runWithConcurrency } from "../utils/run-with-concurrency.js";
import { selectProjects } from "../utils/select-projects.js";
import { shouldFailForDiagnostics } from "../utils/should-fail-for-diagnostics.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { setSpinnerSilent } from "../utils/spinner.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { VERSION } from "../utils/version.js";

const writePrCommentMarkdownIfRequested = (
  outputPath: string | undefined,
  report: JsonReport,
  baseDirectory: string,
): void => {
  if (!outputPath) return;
  const markdown = buildPrCommentMarkdown(report, { baseDirectory });
  const directory = path.dirname(outputPath);
  if (directory && directory !== "." && !fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(outputPath, `${markdown}\n`);
};

const resolveTouchedLinesByFile = (
  projectDirectory: string,
  diffInfo: DiffInfo | null,
  changedSourceFiles: ReadonlyArray<string>,
): TouchedLinesByFile => {
  if (!diffInfo || changedSourceFiles.length === 0) return new Map();
  const baseRef = diffInfo.diffBaseRef ?? null;
  return getTouchedLines({
    directory: projectDirectory,
    baseRef,
    filePaths: changedSourceFiles,
  });
};

export const inspectAction = async (directory: string, flags: InspectFlags): Promise<void> => {
  const isScoreOnly = Boolean(flags.score);
  const isJsonMode = Boolean(flags.json);
  const prCommentOutput = flags.prCommentOutput;
  const isQuiet = isScoreOnly || isJsonMode;
  const requestedDirectory = path.resolve(directory);
  const startTime = performance.now();

  if (isJsonMode) {
    enableJsonMode({ compact: Boolean(flags.jsonCompact), directory: requestedDirectory });
  }
  // `--pr-comment-output` writes a side file; suppress the spinner
  // so it doesn't intersperse with the CLI's stdout output. Logger
  // is left alone - users still want to see the build-log summary.
  if (prCommentOutput) setSpinnerSilent(true);

  try {
    validateModeFlags(flags);

    const loadedConfig = loadConfigWithSource(requestedDirectory);
    const userConfig = loadedConfig?.config ?? null;
    const redirectedDirectory = resolveConfigRootDir(
      loadedConfig?.config ?? null,
      loadedConfig?.sourceDirectory ?? null,
    );
    const resolvedDirectory = redirectedDirectory ?? requestedDirectory;
    setJsonReportDirectory(resolvedDirectory);
    if (redirectedDirectory && !isQuiet) {
      logger.dim(
        `Redirected to ${highlighter.info(toRelativePath(resolvedDirectory, requestedDirectory))} via react-doctor config "rootDir".`,
      );
      logger.break();
    }

    const explainArgument = flags.explain ?? flags.why;
    if (explainArgument !== undefined) {
      await runExplain(explainArgument, {
        resolvedDirectory,
        userConfig,
        scanOptions: resolveCliInspectOptions(flags, userConfig),
        projectFlag: flags.project,
      });
      return;
    }

    if (!isQuiet) {
      printBrandedHeader();
    }

    const scanOptions = resolveCliInspectOptions(flags, userConfig);
    const skipPrompts = shouldSkipPrompts({ yes: flags.yes, full: flags.full, json: flags.json });

    if (!flags.offline && isCiEnvironment() && !isQuiet) {
      logger.dim("CI detected — scoring locally.");
      logger.break();
    }

    if (flags.staged) {
      setJsonReportMode("staged");
      const stagedFiles = getStagedSourceFiles(resolvedDirectory);
      if (stagedFiles.length === 0) {
        if (isJsonMode || prCommentOutput) {
          const emptyReport = buildJsonReport({
            version: VERSION,
            directory: resolvedDirectory,
            mode: "staged",
            diff: null,
            scans: [],
            totalElapsedMilliseconds: performance.now() - startTime,
          });
          if (isJsonMode) writeJsonReport(emptyReport);
          writePrCommentMarkdownIfRequested(prCommentOutput, emptyReport, resolvedDirectory);
        }
        if (!isQuiet && !isScoreOnly) {
          logger.dim("No staged source files found.");
        }
        return;
      }

      if (!isQuiet) {
        logger.log(`Scanning ${highlighter.info(`${stagedFiles.length}`)} staged files...`);
        logger.break();
      }

      const tempDirectory = mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
      const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);
      const touchedLinesOnly = flags.touchedLines ?? userConfig?.touchedLinesOnly ?? false;
      // HACK: for `--staged`, touched-lines comes from the index diff vs
      // HEAD rather than vs a base branch - that's the surface devs are
      // about to commit. We resolve at the original repo root (not the
      // tempdir snapshot) and map paths into the materialized layout.
      let touchedLinesByFile: TouchedLinesByFile | undefined;
      if (touchedLinesOnly) {
        const originalTouched = getTouchedLines({
          directory: resolvedDirectory,
          baseRef: "--cached",
          filePaths: snapshot.stagedFiles,
        });
        const tempMapped = new Map<string, ReturnType<typeof originalTouched.get>>();
        for (const [filePath, ranges] of originalTouched) {
          tempMapped.set(filePath, ranges);
        }
        touchedLinesByFile = tempMapped as TouchedLinesByFile;
      }
      try {
        const scanResult = await inspect(snapshot.tempDirectory, {
          ...scanOptions,
          includePaths: snapshot.stagedFiles,
          touchedLinesByFile,
          configOverride: userConfig,
        });

        // Maps diagnostic paths from the staged-files tempdir back to
        // the real project root. Used for both `scanResult.diagnostics`
        // and `scanResult.baselineDiagnostics`; if the latter weren't
        // remapped the JSON report and the --update-baseline write
        // would surface tempdir paths.
        const remapDiagnostic = <T extends Diagnostic>(diagnostic: T): T => ({
          ...diagnostic,
          filePath: path.isAbsolute(diagnostic.filePath)
            ? diagnostic.filePath.replaceAll(snapshot.tempDirectory, resolvedDirectory)
            : diagnostic.filePath,
        });
        const remappedDiagnostics = scanResult.diagnostics.map(remapDiagnostic);
        const remappedBaselineDiagnostics = scanResult.baselineDiagnostics?.map(remapDiagnostic);

        const needsStagedAggregatedReport = isJsonMode || prCommentOutput;
        if (needsStagedAggregatedReport) {
          const remappedInspectResult: InspectResult = {
            ...scanResult,
            diagnostics: remappedDiagnostics,
            project: { ...scanResult.project, rootDirectory: resolvedDirectory },
            ...(remappedBaselineDiagnostics !== undefined
              ? { baselineDiagnostics: remappedBaselineDiagnostics }
              : {}),
          };
          const stagedReport = buildJsonReport({
            version: VERSION,
            directory: resolvedDirectory,
            mode: "staged",
            diff: null,
            scans: [{ directory: resolvedDirectory, result: remappedInspectResult }],
            totalElapsedMilliseconds: performance.now() - startTime,
          });
          if (isJsonMode) writeJsonReport(stagedReport);
          writePrCommentMarkdownIfRequested(prCommentOutput, stagedReport, resolvedDirectory);
        }

        if (flags.updateBaseline) {
          const aggregatedDiagnostics = [
            ...remappedDiagnostics,
            ...(remappedBaselineDiagnostics ?? []),
          ];
          const baselineSettings = resolveBaselineSettings(
            userConfig,
            flags.baseline,
            resolvedDirectory,
          );
          const baselineFile = buildBaselineFile(aggregatedDiagnostics, resolvedDirectory);
          writeBaselineFile(baselineSettings.filePath, baselineFile);
          if (!isQuiet) {
            const baselineRelativePath = toRelativePath(
              baselineSettings.filePath,
              resolvedDirectory,
            );
            logger.success(
              `Wrote ${aggregatedDiagnostics.length} diagnostic${aggregatedDiagnostics.length === 1 ? "" : "s"} from staged files to ${highlighter.info(baselineRelativePath)}`,
            );
          }
        }

        if (flags.annotations) {
          printAnnotations(remappedDiagnostics, isJsonMode);
        }

        const ciFailureDiagnostics = filterDiagnosticsForSurface(
          remappedDiagnostics,
          "ciFailure",
          userConfig,
        );
        if (
          !isScoreOnly &&
          shouldFailForDiagnostics(ciFailureDiagnostics, resolveFailOnLevel(flags, userConfig))
        ) {
          process.exitCode = 1;
        }
      } finally {
        snapshot.cleanup();
      }
      return;
    }

    const projectDirectories = await selectProjects(resolvedDirectory, flags.project, skipPrompts);

    const effectiveDiff = resolveEffectiveDiff(flags, userConfig);
    const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
    const wantsDiffMode = effectiveDiff !== undefined && effectiveDiff !== false;
    // HACK: also call getDiffInfo when we MIGHT prompt the user — without
    // it, resolveDiffMode short-circuits at !diffInfo and the
    // "Only scan changed files?" prompt never appears for users on a
    // feature branch who didn't explicitly pass --diff.
    const shouldDetectDiff = wantsDiffMode || (!skipPrompts && !isQuiet);
    const diffInfo = shouldDetectDiff ? getDiffInfo(resolvedDirectory, explicitBaseBranch) : null;
    const isDiffMode = await resolveDiffMode(diffInfo, effectiveDiff, skipPrompts, isQuiet);

    // HACK: set the report-mode marker BEFORE the scan loop runs — if the
    // user hits Ctrl-C mid-scan, the SIGINT handler reads it for the JSON
    // cancel report. Setting it after the loop completes means a cancelled
    // diff scan would report mode: "full".
    setJsonReportMode(isDiffMode ? "diff" : "full");

    if (isDiffMode && diffInfo && !isQuiet) {
      if (diffInfo.isCurrentChanges) {
        logger.log("Scanning uncommitted changes");
      } else {
        logger.log(
          `Scanning changes: ${highlighter.info(diffInfo.currentBranch)} → ${highlighter.info(diffInfo.baseBranch)}`,
        );
      }
      logger.break();
    }

    const concurrency = resolveConcurrency(flags.concurrency, userConfig);
    if (concurrency > 1 && !isQuiet) {
      logger.dim(`Scanning up to ${concurrency} projects in parallel`);
      logger.break();
    }
    const touchedLinesOnly = flags.touchedLines ?? userConfig?.touchedLinesOnly ?? false;

    interface PlannedProjectScan {
      directory: string;
      includePaths: string[] | undefined;
      touchedLinesByFile: TouchedLinesByFile | undefined;
      skipReason: string | null;
    }

    const plannedScans: PlannedProjectScan[] = projectDirectories.map((projectDirectory) => {
      if (!isDiffMode) {
        return {
          directory: projectDirectory,
          includePaths: undefined,
          touchedLinesByFile: undefined,
          skipReason: null,
        };
      }
      const projectDiffInfo =
        projectDirectory === resolvedDirectory
          ? diffInfo
          : getDiffInfo(projectDirectory, explicitBaseBranch);
      if (!projectDiffInfo) {
        return {
          directory: projectDirectory,
          includePaths: undefined,
          touchedLinesByFile: undefined,
          skipReason: "no-diff-info",
        };
      }
      const changedSourceFiles = filterSourceFiles(projectDiffInfo.changedFiles);
      if (changedSourceFiles.length === 0) {
        return {
          directory: projectDirectory,
          includePaths: changedSourceFiles,
          touchedLinesByFile: undefined,
          skipReason: "no-changed-files",
        };
      }
      const touchedLinesByFile = touchedLinesOnly
        ? resolveTouchedLinesByFile(projectDirectory, projectDiffInfo, changedSourceFiles)
        : undefined;
      return {
        directory: projectDirectory,
        includePaths: changedSourceFiles,
        touchedLinesByFile,
        skipReason: null,
      };
    });

    for (const plannedScan of plannedScans) {
      if (plannedScan.skipReason === "no-changed-files" && !isQuiet) {
        logger.dim(`No changed source files in ${plannedScan.directory}, skipping.`);
        logger.break();
      } else if (plannedScan.skipReason === "no-diff-info" && !isQuiet) {
        logger.dim(
          `Cannot detect diff for ${plannedScan.directory} (not a git repository?) - scanning all files.`,
        );
        logger.break();
      }
    }

    const runnableScans = plannedScans.filter(
      (plannedScan) => plannedScan.skipReason !== "no-changed-files",
    );

    const scanOutputs = await runWithConcurrency(
      runnableScans,
      concurrency,
      async (plannedScan) => {
        if (!isQuiet && concurrency <= 1) {
          logger.dim(`Scanning ${plannedScan.directory}...`);
          logger.break();
        }
        const scanResult = await inspect(plannedScan.directory, {
          ...scanOptions,
          includePaths: plannedScan.includePaths,
          touchedLinesByFile: plannedScan.touchedLinesByFile,
          configOverride: userConfig,
        });
        if (!isQuiet && concurrency <= 1) {
          logger.break();
        }
        return { directory: plannedScan.directory, result: scanResult };
      },
    );

    const allDiagnostics: Diagnostic[] = [];
    const completedScans: Array<{ directory: string; result: InspectResult }> = [];
    for (const scanOutput of scanOutputs) {
      allDiagnostics.push(...scanOutput.result.diagnostics);
      completedScans.push(scanOutput);
    }

    if (flags.updateBaseline) {
      const aggregatedDiagnostics = scanOutputs.flatMap((scanOutput) => [
        ...scanOutput.result.diagnostics,
        ...(scanOutput.result.baselineDiagnostics ?? []),
      ]);
      const baselineSettings = resolveBaselineSettings(
        userConfig,
        flags.baseline,
        resolvedDirectory,
      );
      const baselineFile = buildBaselineFile(aggregatedDiagnostics, resolvedDirectory);
      writeBaselineFile(baselineSettings.filePath, baselineFile);
      if (!isQuiet) {
        const baselineRelativePath = toRelativePath(baselineSettings.filePath, resolvedDirectory);
        logger.success(
          `Wrote ${aggregatedDiagnostics.length} diagnostic${aggregatedDiagnostics.length === 1 ? "" : "s"} to ${highlighter.info(baselineRelativePath)}`,
        );
      }
    }

    let aggregatedReport: JsonReport | null = null;
    if (isJsonMode || prCommentOutput) {
      aggregatedReport = buildJsonReport({
        version: VERSION,
        directory: resolvedDirectory,
        mode: isDiffMode ? "diff" : "full",
        diff: isDiffMode ? diffInfo : null,
        scans: completedScans,
        totalElapsedMilliseconds: performance.now() - startTime,
      });
      if (isJsonMode) writeJsonReport(aggregatedReport);
      writePrCommentMarkdownIfRequested(prCommentOutput, aggregatedReport, resolvedDirectory);
    }

    if (flags.annotations) {
      printAnnotations(allDiagnostics, isJsonMode);
    }

    const ciFailureDiagnostics = filterDiagnosticsForSurface(
      allDiagnostics,
      "ciFailure",
      userConfig,
    );
    if (
      !isScoreOnly &&
      shouldFailForDiagnostics(ciFailureDiagnostics, resolveFailOnLevel(flags, userConfig))
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (isJsonMode) {
      writeJsonErrorReport(error);
      process.exitCode = 1;
      return;
    }
    handleError(error);
  }
};
