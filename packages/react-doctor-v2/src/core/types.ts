import type { ReactDoctorErrorInfo } from "./errors.js";

export interface SourceLocation {
  filePath: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface ReactDoctorIssueSource {
  checkId: string;
  pluginName?: string;
  ruleId?: string;
}

export interface ReactDoctorIssue {
  id: string;
  title: string;
  message: string;
  severity: "error" | "warning" | "info";
  category: string;
  location?: SourceLocation;
  recommendation?: string;
  source?: ReactDoctorIssueSource;
}

export interface ReactDoctorCheckResult {
  id: string;
  name: string;
  status: "completed" | "failed" | "skipped";
  issues: ReactDoctorIssue[];
  durationMilliseconds: number;
  error?: ReactDoctorErrorInfo;
}

export interface ReactDoctorScore {
  value: number;
  label: string;
}

export type ReactDoctorFailOnLevel = "error" | "warning" | "none";

export type ReactProjectFramework =
  | "cra"
  | "expo"
  | "gatsby"
  | "nextjs"
  | "react"
  | "react-native"
  | "remix"
  | "tanstack-start"
  | "unknown"
  | "vite";

export interface ReactProjectInfo {
  rootDirectory: string;
  projectName: string;
  packageJsonPath: string | null;
  reactVersion: string | null;
  reactMajorVersion: number | null;
  reactPeerDependencyRange: string | null;
  tailwindVersion: string | null;
  framework: ReactProjectFramework;
  hasTypeScript: boolean;
  hasReactCompiler: boolean;
  hasTanStackAI: boolean;
  hasTanStackQuery: boolean;
  sourceFileCount: number;
}

export interface ReactDoctorResult {
  status: "completed" | "completed-with-errors" | "failed";
  project: ReactProjectInfo;
  issues: ReactDoctorIssue[];
  checks: ReactDoctorCheckResult[];
  score: ReactDoctorScore | null;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
}

export interface ReactDoctorRuleSelection {
  enabledRuleIds?: string[];
  disabledRuleIds?: string[];
}

export interface ReactDoctorIgnoreOverride {
  files: string[];
  rules?: string[];
}

export interface ReactDoctorIgnoreConfig {
  rules?: string[];
  files?: string[];
  overrides?: ReactDoctorIgnoreOverride[];
}

export interface ReactDoctorConfig {
  ignore?: ReactDoctorIgnoreConfig;
  lint?: boolean;
  deadCode?: boolean;
  verbose?: boolean;
  diff?: boolean | string;
  offline?: boolean;
  failOn?: ReactDoctorFailOnLevel;
  customRulesOnly?: boolean;
  rootDir?: string;
  textComponents?: string[];
  rawTextWrapperComponents?: string[];
  respectInlineDisables?: boolean;
  adoptExistingLintConfig?: boolean;
  includeEcosystemRules?: boolean;
  ignoredTags?: string[];
}

export interface LoadedReactDoctorConfig {
  config: ReactDoctorConfig;
  sourceDirectory: string;
  sourcePath: string;
}

export interface ReactDoctorJsonReportSummary {
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalIssueCount: number;
  score: number | null;
  scoreLabel: string | null;
}

export interface ReactDoctorJsonReport {
  schemaVersion: 1;
  ok: boolean;
  project: ReactProjectInfo;
  issues: ReactDoctorIssue[];
  checks: ReactDoctorCheckResult[];
  summary: ReactDoctorJsonReportSummary;
  startedAt: string;
  completedAt: string;
  durationMilliseconds: number;
}

export interface InspectReactProjectOptions {
  rootDirectory?: string;
  includePaths?: string[];
  excludePatterns?: string[];
  rules?: ReactDoctorRuleSelection;
  config?: ReactDoctorConfig | null;
  lint?: boolean;
  deadCode?: boolean;
  customRulesOnly?: boolean;
  respectInlineDisables?: boolean;
  offline?: boolean;
  signal?: AbortSignal;
}
