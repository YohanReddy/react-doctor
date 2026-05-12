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
import type { ReactDoctorFailOnLevel, ReactDoctorIssue, ReactDoctorResult } from "../sdk/index.js";

const VERSION = process.env.VERSION ?? "0.0.0";
const SOURCE_FILE_PATTERN = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;

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
    const reactDoctor = createReactDoctor({
      rootDirectory: directory,
      includePaths: shouldSkipSourceChecks ? undefined : includePaths,
    });
    const result = await reactDoctor.inspect({
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
    });

    printInspectionResult(result, effectiveFlags);
    if (shouldFailForIssues(result.issues, failOn)) {
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
