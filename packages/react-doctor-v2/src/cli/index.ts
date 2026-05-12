import { spawnSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import { CANONICAL_GITHUB_URL, DEFAULT_DIRECTORY, EXIT_FAILURE_CODE } from "../constants.js";
import { handleCliError } from "./handle-error.js";
import { highlighter } from "./highlighter.js";
import {
  buildReactDoctorJsonReport,
  createReactDoctor,
  loadReactDoctorConfig,
} from "../sdk/index.js";
import { createCodebaseAnalysisConfig } from "../core/rules/codebase/analyzer/config.js";
import { discoverWorkspaces } from "../core/rules/codebase/analyzer/workspace.js";
import type { ReactDoctorFailOnLevel, ReactDoctorIssue, ReactDoctorResult } from "../sdk/index.js";
import type { WorkspaceInfo } from "../core/rules/codebase/analyzer/index.js";

const VERSION = process.env.VERSION ?? "0.0.0";
const SOURCE_FILE_PATTERN = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const REACT_PROJECT_DEPENDENCIES = new Set([
  "@remix-run/react",
  "@tanstack/react-start",
  "expo",
  "gatsby",
  "next",
  "react",
  "react-native",
  "react-scripts",
  "vite",
]);

interface CliFlags {
  json: boolean;
  jsonCompact: boolean;
  lint: boolean;
  deadCode: boolean;
  customRulesOnly: boolean;
  staged: boolean;
  unstaged: boolean;
  changed: boolean;
  diff?: boolean | string;
  offline: boolean;
  failOn: string;
}

const isSourceFile = (filePath: string): boolean => SOURCE_FILE_PATTERN.test(filePath);

const isReactWorkspace = (workspace: WorkspaceInfo): boolean =>
  [...REACT_PROJECT_DEPENDENCIES].some((dependencyName) =>
    workspace.dependencyNames.has(dependencyName),
  );

const resolveProjectDirectories = async (
  rootDirectory: string,
  configHasRootDirectory: boolean,
  shouldUseSingleProject: boolean,
): Promise<string[]> => {
  if (configHasRootDirectory || shouldUseSingleProject) return [rootDirectory];
  const workspaces = await discoverWorkspaces(
    createCodebaseAnalysisConfig({
      rootDirectory,
    }),
  );
  const reactWorkspaces = workspaces.filter(isReactWorkspace);
  if (reactWorkspaces.length === 0) return [rootDirectory];
  if (reactWorkspaces.length === 1) return [reactWorkspaces[0].directory];
  return reactWorkspaces.map((workspace) => workspace.directory);
};

const getGitFiles = (rootDirectory: string, args: string[]): string[] => {
  const result = spawnSync("git", args, {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split("\0")
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0 && isSourceFile(filePath));
};

const dedupeFilePaths = (filePaths: string[]): string[] => [...new Set(filePaths)];

const resolveIncludePaths = (rootDirectory: string, flags: CliFlags): string[] | undefined => {
  if (flags.staged) {
    return getGitFiles(rootDirectory, ["diff", "--cached", "--name-only", "-z"]);
  }
  if (flags.unstaged) {
    return dedupeFilePaths([
      ...getGitFiles(rootDirectory, ["diff", "--name-only", "-z"]),
      ...getGitFiles(rootDirectory, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
  }
  if (flags.changed) {
    return dedupeFilePaths([
      ...getGitFiles(rootDirectory, ["diff", "--name-only", "-z", "HEAD"]),
      ...getGitFiles(rootDirectory, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
  }
  if (flags.diff) {
    const baseBranch = typeof flags.diff === "string" ? flags.diff : "main";
    return getGitFiles(rootDirectory, ["diff", "--name-only", "-z", `${baseBranch}...HEAD`]);
  }
  return undefined;
};

const isChangedFileMode = (flags: CliFlags): boolean =>
  flags.staged || flags.unstaged || flags.changed || Boolean(flags.diff);

const getCliOptionOverride = <Value>(
  command: Command,
  optionName: string,
  value: Value,
): Value | undefined => (command.getOptionValueSource(optionName) === "cli" ? value : undefined);

const resolveBooleanInspectOption = (
  command: Command,
  optionName: string,
  flagValue: boolean,
  configValue: boolean | undefined,
  defaultValue: boolean,
): boolean | undefined => {
  const cliValue = getCliOptionOverride(command, optionName, flagValue);
  if (cliValue !== undefined) return cliValue;
  return configValue === undefined ? defaultValue : undefined;
};

const normalizeFailOnLevel = (value: string | undefined): ReactDoctorFailOnLevel => {
  if (value === "error" || value === "warning" || value === "none") return value;
  return "none";
};

const shouldFailForIssues = (
  issues: ReactDoctorIssue[],
  failOnLevel: ReactDoctorFailOnLevel,
): boolean => {
  if (failOnLevel === "none") return false;
  if (failOnLevel === "warning") return issues.length > 0;
  return issues.some((issue) => issue.severity === "error");
};

const groupIssuesByCategory = (issues: ReactDoctorIssue[]): Map<string, ReactDoctorIssue[]> => {
  const groups = new Map<string, ReactDoctorIssue[]>();
  for (const issue of issues) {
    const categoryIssues = groups.get(issue.category) ?? [];
    categoryIssues.push(issue);
    groups.set(issue.category, categoryIssues);
  }
  return groups;
};

const formatLocation = (issue: ReactDoctorIssue): string => {
  const location = issue.location;
  if (!location?.filePath) return "";
  const line = location.line ? `:${location.line}` : "";
  const column = location.column ? `:${location.column}` : "";
  return highlighter.dim(` ${location.filePath}${line}${column}`);
};

const printInspectionResult = (result: ReactDoctorResult, flags: CliFlags): void => {
  if (flags.json) {
    const report = buildReactDoctorJsonReport(result);
    process.stdout.write(
      `${flags.jsonCompact ? JSON.stringify(report) : JSON.stringify(report, null, 2)}\n`,
    );
    return;
  }

  console.log(`react-doctor ${highlighter.dim(`v${VERSION}`)}`);
  console.log("");
  console.log(
    `${highlighter.bold(result.project.projectName)} ${highlighter.dim(result.project.rootDirectory)}`,
  );
  console.log(
    `${result.score?.value ?? 100}/100 ${highlighter.dim(result.score?.label ?? "Great")} · ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}`,
  );

  if (result.issues.length === 0) {
    console.log("");
    console.log(`${highlighter.success("✔")} No React Doctor issues found.`);
    return;
  }

  for (const [category, issues] of groupIssuesByCategory(result.issues)) {
    console.log("");
    console.log(highlighter.bold(category));
    for (const issue of issues) {
      const marker = issue.severity === "error" ? highlighter.error("✖") : highlighter.warn("!");
      console.log(`${marker} ${issue.title}${formatLocation(issue)}`);
      console.log(`  ${issue.message}`);
      if (issue.recommendation) console.log(`  ${highlighter.dim(issue.recommendation)}`);
    }
  }
};

const toAggregateJsonReport = (results: ReactDoctorResult[]) => {
  const reports = results.map(buildReactDoctorJsonReport);
  const issues = results.flatMap((result) => result.issues);
  const checks = results.flatMap((result) => result.checks);
  const affectedFiles = new Set(
    issues.flatMap((issue) => (issue.location?.filePath ? [issue.location.filePath] : [])),
  );
  const scores = results
    .map((result) => result.score?.value)
    .filter((score): score is number => typeof score === "number");
  const worstScore = scores.length ? Math.min(...scores) : null;
  const worstScoreLabel =
    results.find((result) => result.score?.value === worstScore)?.score?.label ?? null;
  return {
    schemaVersion: 1,
    ok: reports.every((report) => report.ok),
    projects: reports.map((report) => ({
      project: report.project,
      issues: report.issues,
      checks: report.checks,
      summary: report.summary,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      durationMilliseconds: report.durationMilliseconds,
    })),
    issues,
    checks,
    summary: {
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      affectedFileCount: affectedFiles.size,
      totalIssueCount: issues.length,
      score: worstScore,
      scoreLabel: worstScoreLabel,
    },
    startedAt: results[0]?.startedAt,
    completedAt: results.at(-1)?.completedAt,
    durationMilliseconds: results.reduce((total, result) => total + result.durationMilliseconds, 0),
  };
};

const printInspectionResults = (results: ReactDoctorResult[], flags: CliFlags): void => {
  if (results.length === 1) {
    printInspectionResult(results[0], flags);
    return;
  }
  if (flags.json) {
    const report = toAggregateJsonReport(results);
    process.stdout.write(
      `${flags.jsonCompact ? JSON.stringify(report) : JSON.stringify(report, null, 2)}\n`,
    );
    return;
  }

  console.log(`react-doctor ${highlighter.dim(`v${VERSION}`)}`);
  console.log("");
  for (const result of results) {
    console.log(
      `${highlighter.bold(result.project.projectName)} ${highlighter.dim(result.project.rootDirectory)}`,
    );
    console.log(
      `${result.score?.value ?? 100}/100 ${highlighter.dim(result.score?.label ?? "Great")} · ${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}`,
    );
    console.log("");
  }
};

const program = new Command()
  .name("react-doctor")
  .description("Inspect React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to inspect", DEFAULT_DIRECTORY)
  .option("--json", "output the inspection result as JSON")
  .option("--json-compact", "output compact JSON")
  .option("--no-lint", "skip oxlint checks")
  .option("--no-dead-code", "skip codebase graph checks")
  .option("--custom-rules-only", "run only react-doctor custom oxlint rules")
  .option("--staged", "only inspect staged source files")
  .option("--unstaged", "only inspect unstaged and untracked source files")
  .option("--changed", "only inspect source files changed since HEAD")
  .option("--diff [base]", "only inspect source files changed against a base branch")
  .option("--offline", "disable network-dependent integrations")
  .option("--fail-on <level>", "exit non-zero for error, warning, or none", "none")
  .action(async (directory: string, flags: CliFlags, command: Command) => {
    const rootDirectory = path.resolve(directory);
    const loadedConfig = await loadReactDoctorConfig(rootDirectory);
    const config = loadedConfig?.config ?? {};
    const effectiveFlags: CliFlags = {
      ...flags,
      diff:
        command.getOptionValueSource("diff") === "cli" ? flags.diff : (config.diff ?? flags.diff),
    };
    const failOn =
      command.getOptionValueSource("failOn") === "cli"
        ? normalizeFailOnLevel(flags.failOn)
        : normalizeFailOnLevel(config.failOn ?? flags.failOn);
    const includePaths = resolveIncludePaths(rootDirectory, effectiveFlags);
    const shouldSkipSourceChecks = isChangedFileMode(effectiveFlags) && includePaths?.length === 0;
    const projectDirectories = await resolveProjectDirectories(
      rootDirectory,
      Boolean(config.rootDir),
      isChangedFileMode(effectiveFlags),
    );
    const inspectOptions = {
      lint: shouldSkipSourceChecks
        ? false
        : resolveBooleanInspectOption(command, "lint", flags.lint, config.lint, true),
      deadCode: shouldSkipSourceChecks
        ? false
        : resolveBooleanInspectOption(command, "deadCode", flags.deadCode, config.deadCode, true),
      customRulesOnly: resolveBooleanInspectOption(
        command,
        "customRulesOnly",
        flags.customRulesOnly,
        config.customRulesOnly,
        false,
      ),
      offline: resolveBooleanInspectOption(
        command,
        "offline",
        flags.offline,
        config.offline,
        false,
      ),
    };
    const results = await Promise.all(
      projectDirectories.map((projectDirectory) =>
        createReactDoctor({
          rootDirectory: projectDirectory,
          includePaths: shouldSkipSourceChecks ? undefined : includePaths,
        }).inspect(inspectOptions),
      ),
    );

    printInspectionResults(results, effectiveFlags);
    if (
      shouldFailForIssues(
        results.flatMap((result) => result.issues),
        failOn,
      )
    ) {
      process.exitCode = EXIT_FAILURE_CODE;
    }
  })
  .addHelpText(
    "after",
    `
${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`,
  );

program.parseAsync().catch(handleCliError);
