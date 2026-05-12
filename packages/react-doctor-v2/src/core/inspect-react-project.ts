import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DIRECTORY } from "../constants.js";
import { filterReactDoctorIssues } from "./diagnostics.js";
import { toReactDoctorErrorInfo } from "./errors.js";
import { calculateReactDoctorScore } from "./reports.js";
import { OXLINT_CHECK_ID, runOxlint } from "./runners/oxlint.js";
import { loadReactDoctorConfig, resolveConfigRootDirectory } from "./config.js";
import { discoverReactProject, toOxlintProjectInfo } from "./project.js";
import { createRuleRegistry } from "./rules/index.js";
import { runCodebaseAnalysis } from "./rules/codebase/analyzer/index.js";
import {
  DEAD_CODE_RULE_ID,
  DEPENDENCIES_RULE_ID,
  REACT_ARCHITECTURE_RULE_ID,
} from "./rules/index.js";
import type {
  InspectReactProjectOptions,
  LoadedReactDoctorConfig,
  ReactDoctorCheckResult,
  ReactDoctorConfig,
  ReactDoctorIssue,
  ReactDoctorResult,
  ReactDoctorRuleSelection,
} from "./types.js";

const mergeConfig = (
  loadedConfig: LoadedReactDoctorConfig | null,
  options: InspectReactProjectOptions,
): ReactDoctorConfig => ({
  ...loadedConfig?.config,
  ...options.config,
  lint: options.lint ?? options.config?.lint ?? loadedConfig?.config.lint,
  deadCode: options.deadCode ?? options.config?.deadCode ?? loadedConfig?.config.deadCode,
  customRulesOnly:
    options.customRulesOnly ??
    options.config?.customRulesOnly ??
    loadedConfig?.config.customRulesOnly,
  respectInlineDisables:
    options.respectInlineDisables ??
    options.config?.respectInlineDisables ??
    loadedConfig?.config.respectInlineDisables,
  offline: options.offline ?? options.config?.offline ?? loadedConfig?.config.offline,
});

const mergeRuleSelection = (
  selection: ReactDoctorRuleSelection | undefined,
  config: ReactDoctorConfig,
): ReactDoctorRuleSelection => {
  const enabledRuleIds = [...(selection?.enabledRuleIds ?? [])];
  if (config.deadCode) {
    enabledRuleIds.push(DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID, REACT_ARCHITECTURE_RULE_ID);
  }
  return {
    enabledRuleIds,
    disabledRuleIds: selection?.disabledRuleIds,
  };
};

const readSourceLines = (rootDirectory: string, filePath: string): string[] | undefined => {
  try {
    return fs.readFileSync(path.resolve(rootDirectory, filePath), "utf8").split(/\r?\n/);
  } catch {
    return undefined;
  }
};

const createOxlintCheck = async (
  rootDirectory: string,
  config: ReactDoctorConfig,
  options: InspectReactProjectOptions,
  project: ReactDoctorResult["project"],
): Promise<ReactDoctorCheckResult | null> => {
  if (config.lint !== true) return null;

  const startedMilliseconds = globalThis.performance.now();
  try {
    const issues = await runOxlint({
      rootDirectory,
      includePaths: options.includePaths,
      excludePatterns: options.excludePatterns,
      project: toOxlintProjectInfo(project),
      customRulesOnly: config.customRulesOnly,
      includeEcosystemRules: config.includeEcosystemRules,
      adoptExistingLintConfig: config.adoptExistingLintConfig,
      ignoredTags: config.ignoredTags ? new Set(config.ignoredTags) : undefined,
      signal: options.signal,
    });
    return {
      id: OXLINT_CHECK_ID,
      name: "Oxlint",
      status: "completed",
      issues,
      durationMilliseconds: globalThis.performance.now() - startedMilliseconds,
    };
  } catch (error) {
    return {
      id: OXLINT_CHECK_ID,
      name: "Oxlint",
      status: "failed",
      issues: [],
      durationMilliseconds: globalThis.performance.now() - startedMilliseconds,
      error: toReactDoctorErrorInfo(error),
    };
  }
};

const applyIssueFiltering = (
  checks: ReactDoctorCheckResult[],
  filteredIssues: ReactDoctorIssue[],
): ReactDoctorCheckResult[] => {
  const issueIds = new Set(filteredIssues.map((issue) => issue.id));
  return checks.map((check) => ({
    ...check,
    issues: check.issues.filter((issue) => issueIds.has(issue.id)),
  }));
};

export const inspectReactProjectCore = async (
  options: InspectReactProjectOptions = {},
): Promise<ReactDoctorResult> => {
  options.signal?.throwIfAborted();

  const startedAt = new Date();
  const startedMilliseconds = globalThis.performance.now();
  const requestedRootDirectory = path.resolve(options.rootDirectory ?? DEFAULT_DIRECTORY);
  const loadedConfig =
    options.config === undefined ? await loadReactDoctorConfig(requestedRootDirectory) : null;
  const rootDirectory = await resolveConfigRootDirectory(loadedConfig, requestedRootDirectory);
  const config = mergeConfig(loadedConfig, options);
  const project = await discoverReactProject(rootDirectory);

  options.signal?.throwIfAborted();

  const registry = createRuleRegistry();
  let codebaseAnalysisPromise: ReturnType<typeof runCodebaseAnalysis> | null = null;
  const getCodebaseAnalysis = () => {
    codebaseAnalysisPromise ??= runCodebaseAnalysis({
      rootDirectory,
      includePaths: options.includePaths,
      excludePatterns: options.excludePatterns,
      signal: options.signal,
    });
    return codebaseAnalysisPromise;
  };
  const checks = await registry.runRules({
    rootDirectory,
    includePaths: options.includePaths,
    excludePatterns: options.excludePatterns,
    selection: mergeRuleSelection(options.rules, config),
    signal: options.signal,
    getCodebaseAnalysis,
  });
  const oxlintCheck = await createOxlintCheck(rootDirectory, config, options, project);
  const allChecks = oxlintCheck ? [...checks, oxlintCheck] : checks;
  const completedAt = new Date();
  const issues = filterReactDoctorIssues(
    allChecks.flatMap((check) => check.issues),
    config,
    rootDirectory,
    (filePath) => readSourceLines(rootDirectory, filePath),
  );
  const filteredChecks = applyIssueFiltering(allChecks, issues);
  const hasFailedChecks = filteredChecks.some((check) => check.status === "failed");

  return {
    status: hasFailedChecks ? "completed-with-errors" : "completed",
    project,
    issues,
    checks: filteredChecks,
    score: calculateReactDoctorScore(issues),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMilliseconds: globalThis.performance.now() - startedMilliseconds,
  };
};
