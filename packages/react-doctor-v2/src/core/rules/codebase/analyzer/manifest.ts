import fs from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_CONFIG_DEPENDENCY_FIELDS,
  PACKAGE_JSON_FILENAME,
  SCRIPT_BINARY_PACKAGE_NAME_ALIASES,
  SCRIPT_COMMAND_SEPARATORS,
  SCRIPT_IGNORED_COMMANDS,
  SCRIPT_PACKAGE_MANAGER_RUNNER_SUBCOMMANDS,
  SCRIPT_RUNNER_COMMANDS,
  SCRIPT_WRAPPER_COMMANDS,
  SOURCE_ENTRY_FIELDS,
} from "./constants.js";
import type { DependencyBuckets, PackageJsonObject, WorkspaceInfo } from "./types.js";

const EMPTY_OBJECT: Record<string, string> = {};

const toStringMap = (value: unknown): Map<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

export const readPackageJson = async (directory: string): Promise<PackageJsonObject | null> => {
  const packageJsonPath = path.join(directory, PACKAGE_JSON_FILENAME);
  try {
    return JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as PackageJsonObject;
  } catch {
    return null;
  }
};

export const createDependencyBuckets = (manifest: PackageJsonObject): DependencyBuckets => ({
  dependencies: toStringMap(manifest.dependencies ?? EMPTY_OBJECT),
  devDependencies: toStringMap(manifest.devDependencies ?? EMPTY_OBJECT),
  peerDependencies: toStringMap(manifest.peerDependencies ?? EMPTY_OBJECT),
  optionalDependencies: toStringMap(manifest.optionalDependencies ?? EMPTY_OBJECT),
});

export const collectDependencyNames = (dependencyBuckets: DependencyBuckets): Set<string> =>
  new Set(Object.values(dependencyBuckets).flatMap((bucket) => [...bucket.keys()]));

const stripShellTokenQuotes = (token: string): string => token.replace(/^["']|["']$/g, "");

const isEnvironmentAssignment = (token: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);

const toCommandName = (token: string): string => {
  const command = stripShellTokenQuotes(token).split("/").at(-1) ?? "";
  return command.replace(/\.(cmd|ps1|sh)$/, "");
};

const isCommandToken = (token: string): boolean =>
  Boolean(token) && !isEnvironmentAssignment(token) && !token.startsWith("-");

const findNextCommandTokenIndex = (tokens: string[], startIndex: number): number => {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = stripShellTokenQuotes(tokens[index] ?? "");
    if (SCRIPT_COMMAND_SEPARATORS.has(token)) return -1;
    if (token === "--") continue;
    if (isCommandToken(token)) return index;
  }
  return -1;
};

const findRunnerCommandIndex = (
  commandName: string,
  tokens: string[],
  startIndex: number,
): number => {
  if (SCRIPT_RUNNER_COMMANDS.has(commandName)) {
    return findNextCommandTokenIndex(tokens, startIndex);
  }
  const runnerSubcommands = SCRIPT_PACKAGE_MANAGER_RUNNER_SUBCOMMANDS[commandName];
  if (!runnerSubcommands) return -1;
  const subcommandIndex = findNextCommandTokenIndex(tokens, startIndex);
  if (subcommandIndex < 0) return -1;
  const subcommand = toCommandName(stripShellTokenQuotes(tokens[subcommandIndex] ?? ""));
  if (!runnerSubcommands.has(subcommand)) return -1;
  return findNextCommandTokenIndex(tokens, subcommandIndex + 1);
};

const resolveCommandPackageNames = (
  commandName: string,
  dependencyNames: ReadonlySet<string>,
): string[] => {
  const aliases = SCRIPT_BINARY_PACKAGE_NAME_ALIASES[commandName] ?? [commandName];
  const declaredAliases = aliases.filter((packageName) => dependencyNames.has(packageName));
  return declaredAliases.length > 0 ? declaredAliases : aliases.slice(0, 1);
};

const collectScriptCommands = (script: string): string[] => {
  const commands: string[] = [];
  const tokens = script.match(/[^\s]+/g) ?? [];
  let isExpectingCommand = true;
  let environmentAssignmentQuote: string | null = null;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (environmentAssignmentQuote) {
      if (token.endsWith(environmentAssignmentQuote)) environmentAssignmentQuote = null;
      continue;
    }
    const strippedToken = stripShellTokenQuotes(token);
    if (SCRIPT_COMMAND_SEPARATORS.has(strippedToken)) {
      isExpectingCommand = true;
      continue;
    }
    if (isEnvironmentAssignment(strippedToken)) {
      const assignmentValue = token.slice(token.indexOf("=") + 1);
      const openingQuote = assignmentValue[0];
      if (
        (openingQuote === '"' || openingQuote === "'") &&
        !assignmentValue.endsWith(openingQuote)
      ) {
        environmentAssignmentQuote = openingQuote;
      }
      continue;
    }
    if (!isExpectingCommand || strippedToken.startsWith("-")) {
      continue;
    }
    const commandName = toCommandName(strippedToken);
    const runnerCommandIndex = findRunnerCommandIndex(commandName, tokens, index + 1);
    if (runnerCommandIndex >= 0) {
      commands.push(toCommandName(stripShellTokenQuotes(tokens[runnerCommandIndex] ?? "")));
      index = runnerCommandIndex;
      isExpectingCommand = false;
      continue;
    }
    if (!commandName || SCRIPT_IGNORED_COMMANDS.has(commandName)) {
      isExpectingCommand = false;
      continue;
    }
    commands.push(commandName);
    isExpectingCommand = SCRIPT_WRAPPER_COMMANDS.has(commandName);
  }

  return commands;
};

export const collectScriptDependencyNames = (
  manifest: PackageJsonObject,
  dependencyNames: ReadonlySet<string>,
): Set<string> => {
  const scriptDependencyNames = new Set<string>();
  for (const script of Object.values(manifest.scripts ?? EMPTY_OBJECT)) {
    for (const packageName of collectNodeOptionsDependencyNames(script)) {
      scriptDependencyNames.add(packageName);
    }
    for (const commandName of collectScriptCommands(script)) {
      for (const packageName of resolveCommandPackageNames(commandName, dependencyNames)) {
        scriptDependencyNames.add(packageName);
      }
    }
  }
  return scriptDependencyNames;
};

const collectManifestDependencyNamesFromValue = (
  value: unknown,
  dependencyNames: ReadonlySet<string>,
  references: Set<string>,
): void => {
  if (typeof value === "string") {
    const packageName = toManifestPackageName(value);
    if (packageName) references.add(packageName);
    for (const dependencyName of dependencyNames) {
      if (value === dependencyName || value.startsWith(`${dependencyName}/`)) {
        references.add(dependencyName);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectManifestDependencyNamesFromValue(item, dependencyNames, references);
    }
    return;
  }
  for (const item of Object.values(value)) {
    collectManifestDependencyNamesFromValue(item, dependencyNames, references);
  }
};

const isLikelyPackageName = (value: string): boolean =>
  value.startsWith("@") || value.includes("-") || value.includes("/");

const toManifestPackageName = (value: string): string | null => {
  if (value.startsWith(".") || value.startsWith("/") || value.includes(" ")) return null;
  if (!isLikelyPackageName(value)) return null;
  const parts = value.split("/");
  const firstPart = parts[0];
  if (!firstPart) return null;
  if (firstPart.startsWith("@")) {
    const secondPart = parts[1];
    return secondPart ? `${firstPart}/${secondPart}` : null;
  }
  return firstPart;
};

const toNodeOptionsPackageName = (value: string): string | null => {
  if (value.startsWith(".") || value.startsWith("/") || value.includes(" ")) return null;
  const parts = value.split("/");
  const firstPart = parts[0];
  if (!firstPart) return null;
  if (firstPart.startsWith("@")) {
    const secondPart = parts[1];
    return secondPart ? `${firstPart}/${secondPart}` : null;
  }
  return firstPart;
};

const collectNodeOptionsDependencyNames = (script: string): Set<string> => {
  const references = new Set<string>();
  for (const match of script.matchAll(/\bNODE_OPTIONS=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g)) {
    const nodeOptions = match[1] ?? match[2] ?? match[3] ?? "";
    for (const optionMatch of nodeOptions.matchAll(/(?:--require|-r|--import)(?:=|\s+)([^\s]+)/g)) {
      const packageName = toNodeOptionsPackageName(stripShellTokenQuotes(optionMatch[1] ?? ""));
      if (packageName) references.add(packageName);
    }
  }
  return references;
};

export const collectManifestDependencyNames = (
  manifest: PackageJsonObject,
  dependencyNames: ReadonlySet<string>,
): Set<string> => {
  const references = new Set<string>();
  for (const field of MANIFEST_CONFIG_DEPENDENCY_FIELDS) {
    collectManifestDependencyNamesFromValue(manifest[field], dependencyNames, references);
  }
  collectManifestDependencyNamesFromValue(manifest.imports, dependencyNames, references);
  return references;
};

const collectExportEntryValues = (value: unknown, entries: Set<string>): void => {
  if (typeof value === "string") {
    entries.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectExportEntryValues(item, entries);
    return;
  }
  for (const item of Object.values(value)) {
    collectExportEntryValues(item, entries);
  }
};

const collectBinEntries = (manifest: PackageJsonObject, entries: Set<string>): void => {
  if (typeof manifest.bin === "string") {
    entries.add(manifest.bin);
    return;
  }
  if (!manifest.bin || typeof manifest.bin !== "object") return;
  for (const value of Object.values(manifest.bin)) {
    if (typeof value === "string") entries.add(value);
  }
};

export const collectManifestEntrySpecifiers = (manifest: PackageJsonObject): string[] => {
  const entries = new Set<string>();
  for (const field of SOURCE_ENTRY_FIELDS) {
    const value = manifest[field];
    if (typeof value === "string") entries.add(value);
  }
  collectBinEntries(manifest, entries);
  collectExportEntryValues(manifest.exports, entries);
  collectExportEntryValues(manifest.imports, entries);
  return [...entries].filter((entry) => entry.startsWith(".") || entry.startsWith("/")).sort();
};

export const collectManifestSupportSpecifiers = (manifest: PackageJsonObject): string[] => {
  if (!Array.isArray(manifest.sideEffects)) return [];
  return manifest.sideEffects
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.startsWith(".") || entry.startsWith("/"))
    .sort();
};

export const isOptionalPeerDependency = (workspace: WorkspaceInfo, packageName: string): boolean =>
  Boolean(workspace.manifest.peerDependenciesMeta?.[packageName]?.optional);
