import fs from "node:fs/promises";
import path from "node:path";
import {
  PACKAGE_JSON_CONFIG_KEY,
  PACKAGE_JSON_FILENAME,
  REACT_DOCTOR_CONFIG_FILENAME,
} from "../constants.js";
import { ReactDoctorInvalidConfigError } from "./errors.js";
import type { LoadedReactDoctorConfig, ReactDoctorConfig } from "./types.js";

interface UnknownRecord {
  [key: string]: unknown;
}

interface ValidatorContext {
  sourcePath: string;
}

const configCache = new Map<string, LoadedReactDoctorConfig | null>();

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isDirectory = async (filePath: string): Promise<boolean> => {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
};

const parseJsonFile = async (filePath: string): Promise<unknown> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new ReactDoctorInvalidConfigError(`Failed to parse ${filePath}.`, { cause: error });
  }
};

const assertStringArray = (
  value: unknown,
  fieldName: string,
  context: ValidatorContext,
): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ReactDoctorInvalidConfigError(
      `${context.sourcePath}: "${fieldName}" must be an array of strings.`,
    );
  }
  return value;
};

const assertBoolean = (
  value: unknown,
  fieldName: string,
  context: ValidatorContext,
): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ReactDoctorInvalidConfigError(
      `${context.sourcePath}: "${fieldName}" must be a boolean.`,
    );
  }
  return value;
};

const assertString = (
  value: unknown,
  fieldName: string,
  context: ValidatorContext,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ReactDoctorInvalidConfigError(
      `${context.sourcePath}: "${fieldName}" must be a string.`,
    );
  }
  return value;
};

const assertFailOnLevel = (
  value: unknown,
  context: ValidatorContext,
): ReactDoctorConfig["failOn"] => {
  if (value === undefined) return undefined;
  if (value === "error" || value === "warning" || value === "none") return value;
  throw new ReactDoctorInvalidConfigError(
    `${context.sourcePath}: "failOn" must be "error", "warning", or "none".`,
  );
};

const assertDiff = (value: unknown, context: ValidatorContext): ReactDoctorConfig["diff"] => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean" || typeof value === "string") return value;
  throw new ReactDoctorInvalidConfigError(
    `${context.sourcePath}: "diff" must be a boolean or branch name string.`,
  );
};

const assertIgnoreConfig = (
  value: unknown,
  context: ValidatorContext,
): ReactDoctorConfig["ignore"] => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ReactDoctorInvalidConfigError(`${context.sourcePath}: "ignore" must be an object.`);
  }

  const overrides: NonNullable<ReactDoctorConfig["ignore"]>["overrides"] = [];
  if (value.overrides !== undefined) {
    if (
      !Array.isArray(value.overrides) ||
      value.overrides.some((override) => !isRecord(override))
    ) {
      throw new ReactDoctorInvalidConfigError(
        `${context.sourcePath}: "ignore.overrides" must be an array of objects.`,
      );
    }
    for (const override of value.overrides) {
      if (!isRecord(override)) continue;
      overrides.push({
        files: assertStringArray(override.files, "ignore.overrides[].files", context) ?? [],
        rules: assertStringArray(override.rules, "ignore.overrides[].rules", context),
      });
    }
  }

  return {
    rules: assertStringArray(value.rules, "ignore.rules", context),
    files: assertStringArray(value.files, "ignore.files", context),
    overrides,
  };
};

const validateConfig = (value: unknown, sourcePath: string): ReactDoctorConfig => {
  if (!isRecord(value)) {
    throw new ReactDoctorInvalidConfigError(`${sourcePath}: config must be a JSON object.`);
  }

  const context = { sourcePath };
  return {
    ignore: assertIgnoreConfig(value.ignore, context),
    lint: assertBoolean(value.lint, "lint", context),
    deadCode: assertBoolean(value.deadCode, "deadCode", context),
    verbose: assertBoolean(value.verbose, "verbose", context),
    diff: assertDiff(value.diff, context),
    offline: assertBoolean(value.offline, "offline", context),
    failOn: assertFailOnLevel(value.failOn, context),
    customRulesOnly: assertBoolean(value.customRulesOnly, "customRulesOnly", context),
    rootDir: assertString(value.rootDir, "rootDir", context),
    textComponents: assertStringArray(value.textComponents, "textComponents", context),
    rawTextWrapperComponents: assertStringArray(
      value.rawTextWrapperComponents,
      "rawTextWrapperComponents",
      context,
    ),
    respectInlineDisables: assertBoolean(
      value.respectInlineDisables,
      "respectInlineDisables",
      context,
    ),
    adoptExistingLintConfig: assertBoolean(
      value.adoptExistingLintConfig,
      "adoptExistingLintConfig",
      context,
    ),
    includeEcosystemRules: assertBoolean(
      value.includeEcosystemRules,
      "includeEcosystemRules",
      context,
    ),
    ignoredTags: assertStringArray(value.ignoredTags, "ignoredTags", context),
  };
};

const loadConfigFromDirectory = async (
  directory: string,
): Promise<LoadedReactDoctorConfig | null> => {
  const configPath = path.join(directory, REACT_DOCTOR_CONFIG_FILENAME);
  if (await pathExists(configPath)) {
    return {
      config: validateConfig(await parseJsonFile(configPath), configPath),
      sourceDirectory: directory,
      sourcePath: configPath,
    };
  }

  const packageJsonPath = path.join(directory, PACKAGE_JSON_FILENAME);
  if (!(await pathExists(packageJsonPath))) return null;
  const packageJson = await parseJsonFile(packageJsonPath);
  if (!isRecord(packageJson) || !isRecord(packageJson[PACKAGE_JSON_CONFIG_KEY])) return null;

  return {
    config: validateConfig(packageJson[PACKAGE_JSON_CONFIG_KEY], packageJsonPath),
    sourceDirectory: directory,
    sourcePath: `${packageJsonPath}#${PACKAGE_JSON_CONFIG_KEY}`,
  };
};

const isProjectBoundary = async (directory: string): Promise<boolean> =>
  (await pathExists(path.join(directory, ".git"))) ||
  (await pathExists(path.join(directory, "pnpm-workspace.yaml"))) ||
  (await pathExists(path.join(directory, "turbo.json"))) ||
  (await pathExists(path.join(directory, "nx.json")));

export const clearReactDoctorConfigCache = (): void => {
  configCache.clear();
};

export const loadReactDoctorConfig = async (
  startDirectory: string,
): Promise<LoadedReactDoctorConfig | null> => {
  const rootDirectory = path.resolve(startDirectory);
  const cachedConfig = configCache.get(rootDirectory);
  if (cachedConfig !== undefined) return cachedConfig;

  let currentDirectory = rootDirectory;
  while (true) {
    const loadedConfig = await loadConfigFromDirectory(currentDirectory);
    if (loadedConfig) {
      configCache.set(rootDirectory, loadedConfig);
      return loadedConfig;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (currentDirectory === parentDirectory || (await isProjectBoundary(currentDirectory))) {
      configCache.set(rootDirectory, null);
      return null;
    }
    currentDirectory = parentDirectory;
  }
};

export const resolveConfigRootDirectory = async (
  loadedConfig: LoadedReactDoctorConfig | null,
  fallbackDirectory: string,
): Promise<string> => {
  if (!loadedConfig) return fallbackDirectory;
  const rootDir = loadedConfig.config.rootDir?.trim();
  if (!rootDir) return fallbackDirectory;

  const resolvedDirectory = path.isAbsolute(rootDir)
    ? rootDir
    : path.resolve(loadedConfig.sourceDirectory, rootDir);
  if (!(await isDirectory(resolvedDirectory))) {
    throw new ReactDoctorInvalidConfigError(
      `${loadedConfig.sourcePath}: "rootDir" resolved to ${resolvedDirectory}, which is not a directory.`,
    );
  }
  return resolvedDirectory;
};
