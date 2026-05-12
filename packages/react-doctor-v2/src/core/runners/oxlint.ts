import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReactDoctorCheckFailedError, ReactDoctorRunnerUnavailableError } from "../errors.js";
import { createReactDoctorOxlintConfig, reactDoctorOxlintRuleMetadata } from "../rules/index.js";
import type { ReactDoctorOxlintProjectInfo } from "../rules/index.js";
import type { ReactDoctorIssue } from "../types.js";

interface OxlintSpan {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

interface OxlintLabel {
  span?: OxlintSpan;
}

interface OxlintDiagnostic {
  code?: string;
  message?: string;
  severity?: string;
  help?: string;
  url?: string;
  filename?: string;
  labels?: OxlintLabel[];
}

interface OxlintOutput {
  diagnostics?: OxlintDiagnostic[];
}

export interface RunOxlintOptions {
  rootDirectory: string;
  includePaths?: string[];
  excludePatterns?: string[];
  project: ReactDoctorOxlintProjectInfo;
  customRulesOnly?: boolean;
  includeEcosystemRules?: boolean;
  adoptExistingLintConfig?: boolean;
  ignoredTags?: ReadonlySet<string>;
  signal?: AbortSignal;
}

export const OXLINT_CHECK_ID = "react-doctor/oxlint";

const esmRequire = createRequire(import.meta.url);
const OXLINT_STDERR_PREVIEW_LENGTH = 2_000;
const USER_LINT_CONFIG_FILENAMES = [".oxlintrc.json", ".eslintrc.json"];

const metadataByRuleKey = new Map(
  reactDoctorOxlintRuleMetadata.map((metadata) => [metadata.oxlintRuleKey, metadata]),
);

const resolveOxlintBinary = (): string => {
  try {
    const packageJsonPath = esmRequire.resolve("oxlint/package.json");
    return path.join(path.dirname(packageJsonPath), "bin/oxlint");
  } catch (error) {
    throw new ReactDoctorRunnerUnavailableError(
      OXLINT_CHECK_ID,
      "Oxlint is not installed. Add oxlint to the project or install react-doctor-v2 dependencies.",
      { cause: error },
    );
  }
};

const resolvePluginPath = (): string => {
  const candidatePaths = [
    fileURLToPath(new URL("./oxlint-plugin.js", import.meta.url)),
    fileURLToPath(new URL("../../oxlint-plugin.js", import.meta.url)),
  ];
  return candidatePaths.find((candidatePath) => existsSync(candidatePath)) ?? candidatePaths[0];
};

const detectUserLintConfigPaths = (rootDirectory: string): string[] => {
  let currentDirectory = rootDirectory;

  while (true) {
    for (const fileName of USER_LINT_CONFIG_FILENAMES) {
      const configPath = path.join(currentDirectory, fileName);
      if (existsSync(configPath)) return [configPath];
    }
    if (existsSync(path.join(currentDirectory, ".git"))) return [];

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return [];
    currentDirectory = parentDirectory;
  }
};

const splitRuleCode = (code: string): { pluginName: string; ruleId: string } => {
  const separatorIndex = code.indexOf("/");
  if (separatorIndex < 0) return { pluginName: "oxlint", ruleId: code };
  return {
    pluginName: code.slice(0, separatorIndex),
    ruleId: code.slice(separatorIndex + 1),
  };
};

const toRelativeFilename = (rootDirectory: string, filename: string | undefined): string => {
  if (!filename) return "";
  if (!path.isAbsolute(filename)) return filename;
  return path.relative(rootDirectory, filename);
};

const toReactDoctorIssue = (
  diagnostic: OxlintDiagnostic,
  rootDirectory: string,
): ReactDoctorIssue => {
  const code = diagnostic.code ?? "oxlint/unknown";
  const ruleSource = splitRuleCode(code);
  const metadata = metadataByRuleKey.get(code);
  const firstSpan = diagnostic.labels?.[0]?.span;
  const filePath = toRelativeFilename(rootDirectory, diagnostic.filename);
  const severity = diagnostic.severity === "error" ? "error" : "warning";

  return {
    id: `${OXLINT_CHECK_ID}/${code}/${filePath}/${firstSpan?.line ?? 0}/${firstSpan?.column ?? 0}`,
    title: metadata?.name ?? code,
    message: diagnostic.message ?? code,
    severity,
    category: metadata?.category ?? "oxlint",
    recommendation: metadata?.recommendation ?? diagnostic.help,
    location: filePath
      ? {
          filePath,
          line: firstSpan?.line,
          column: firstSpan?.column,
          endLine: firstSpan?.endLine,
          endColumn: firstSpan?.endColumn,
        }
      : undefined,
    source: {
      checkId: OXLINT_CHECK_ID,
      pluginName: ruleSource.pluginName,
      ruleId: ruleSource.ruleId,
    },
  };
};

const formatOxlintOutputPreview = (stdout: string, stderr = ""): string => {
  const combinedOutput = [stdout, stderr].filter((value) => value.trim().length > 0).join("\n");
  return combinedOutput.trim().slice(0, OXLINT_STDERR_PREVIEW_LENGTH);
};

const parseOxlintOutput = (
  stdout: string,
  rootDirectory: string,
  stderr = "",
): ReactDoctorIssue[] => {
  if (!stdout.trim()) return [];
  let output: OxlintOutput;
  try {
    output = JSON.parse(stdout);
  } catch (error) {
    const preview = formatOxlintOutputPreview(stdout, stderr);
    throw new ReactDoctorCheckFailedError(
      OXLINT_CHECK_ID,
      preview ? `Oxlint failed before returning JSON: ${preview}` : "Oxlint returned invalid JSON.",
      {
        cause: error,
      },
    );
  }
  return (output.diagnostics ?? []).map((diagnostic) =>
    toReactDoctorIssue(diagnostic, rootDirectory),
  );
};

const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  signal: AbortSignal | undefined,
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDirectory,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0 || exitCode === 1) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new ReactDoctorCheckFailedError(
          OXLINT_CHECK_ID,
          `Oxlint failed with exit code ${exitCode ?? "unknown"}: ${stderr.slice(0, OXLINT_STDERR_PREVIEW_LENGTH)}`,
        ),
      );
    });
  });

export const runOxlint = async (options: RunOxlintOptions): Promise<ReactDoctorIssue[]> => {
  options.signal?.throwIfAborted();
  const configDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "react-doctor-oxlint-"));
  const configPath = path.join(configDirectory, ".oxlintrc.json");
  const oxlintBinary = resolveOxlintBinary();
  const config = createReactDoctorOxlintConfig({
    pluginPath: resolvePluginPath(),
    project: options.project,
    customRulesOnly: options.customRulesOnly,
    includeEcosystemRules: options.includeEcosystemRules,
    extendsPaths:
      options.adoptExistingLintConfig === true && !options.customRulesOnly
        ? detectUserLintConfigPaths(options.rootDirectory)
        : [],
    ignoredTags: options.ignoredTags,
  });
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });

  try {
    const args = [
      oxlintBinary,
      "-c",
      configPath,
      "--format",
      "json",
      ...(options.excludePatterns ?? []).flatMap((pattern) => ["--ignore-pattern", pattern]),
      ...(options.includePaths?.length ? options.includePaths : ["."]),
    ];
    const { stdout, stderr } = await spawnOxlint(args, options.rootDirectory, options.signal);
    return parseOxlintOutput(stdout, options.rootDirectory, stderr);
  } finally {
    await fs.rm(configDirectory, { recursive: true, force: true });
  }
};
