import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_JSON_FILENAME } from "./constants.js";
import {
  collectDependencyNames,
  collectManifestDependencyNames,
  collectScriptDependencyNames,
  createDependencyBuckets,
  readPackageJson,
} from "./manifest.js";
import { getPackageNameFromSpecifier, matchesGlob, toRelativePath } from "./path-utils.js";
import type {
  CodebaseAnalysisConfig,
  PackageJsonObject,
  WorkspaceInfo,
  WorkspaceSourceMap,
} from "./types.js";

interface TypeScriptConfigJson {
  extends?: unknown;
  compilerOptions?: {
    importHelpers?: unknown;
    jsxImportSource?: unknown;
    outDir?: unknown;
    plugins?: unknown;
    rootDir?: unknown;
    types?: unknown;
  };
  references?: Array<{ path?: unknown }>;
}

interface TypeScriptDirectoryOptions {
  dependencyNames: Set<string>;
  outDir?: string;
  rootDir?: string;
}

const toWorkspacePatternsFromPackageJson = (manifest: PackageJsonObject | null): string[] => {
  if (!manifest?.workspaces) return [];
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return manifest.workspaces.packages ?? [];
};

const stripYamlComment = (line: string): string => {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if ((character === '"' || character === "'") && line[index - 1] !== "\\") {
      quote = quote === character ? null : (quote ?? character);
    }
    if (character === "#" && !quote) return line.slice(0, index);
  }
  return line;
};

const cleanYamlStringValue = (value: string): string =>
  stripYamlComment(value)
    .trim()
    .replace(/^["']|["']$/g, "");

const parseYamlInlineStringArray = (value: string): string[] => {
  const trimmedValue = cleanYamlStringValue(value);
  if (!trimmedValue.startsWith("[") || !trimmedValue.endsWith("]")) return [];
  return trimmedValue.slice(1, -1).split(",").map(cleanYamlStringValue).filter(Boolean);
};

const parsePnpmWorkspacePatterns = (sourceText: string): string[] => {
  const patterns: string[] = [];
  let isInPackagesSection = false;
  let packagesSectionIndent = 0;

  for (const rawLine of sourceText.split("\n")) {
    const line = stripYamlComment(rawLine);
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    const trimmedLine = line.trim();
    const sectionMatch = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(trimmedLine);

    if (sectionMatch && indent === 0) {
      isInPackagesSection = sectionMatch[1] === "packages";
      packagesSectionIndent = indent;
      if (isInPackagesSection && sectionMatch[2]) {
        patterns.push(...parseYamlInlineStringArray(sectionMatch[2]));
      }
      continue;
    }

    if (!isInPackagesSection || indent <= packagesSectionIndent || !trimmedLine.startsWith("-")) {
      continue;
    }

    const pattern = cleanYamlStringValue(trimmedLine.slice(1));
    if (pattern.length > 0) patterns.push(pattern);
  }

  return patterns;
};

const readPnpmWorkspacePatterns = async (rootDirectory: string): Promise<string[]> => {
  try {
    const sourceText = await fs.readFile(path.join(rootDirectory, "pnpm-workspace.yaml"), "utf8");
    return parsePnpmWorkspacePatterns(sourceText);
  } catch {
    return [];
  }
};

const hasPackageJson = async (directory: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(path.join(directory, PACKAGE_JSON_FILENAME));
    return stats.isFile();
  } catch {
    return false;
  }
};

const hasDirectory = async (directory: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const parseJsonWithComments = (sourceText: string): unknown =>
  JSON.parse(sourceText.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"));

const hasFile = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
};

const resolveExtendedTypeScriptConfigPath = async (
  tsconfigPath: string,
  extendsValue: unknown,
): Promise<string | null> => {
  if (typeof extendsValue !== "string" || extendsValue.length === 0) return null;
  if (!extendsValue.startsWith(".") && !extendsValue.startsWith("/")) return null;
  const directory = path.dirname(tsconfigPath);
  const resolvedPath = path.resolve(directory, extendsValue);
  const candidates = [
    resolvedPath,
    `${resolvedPath}.json`,
    path.join(resolvedPath, "tsconfig.json"),
  ];
  for (const candidate of candidates) {
    if (await hasFile(candidate)) return candidate;
  }
  return null;
};

const resolveReferencedTypeScriptConfigPath = async (
  tsconfigPath: string,
  referencePath: unknown,
): Promise<string | null> => {
  if (typeof referencePath !== "string" || referencePath.length === 0) return null;
  const directory = path.dirname(tsconfigPath);
  const resolvedPath = path.resolve(directory, referencePath);
  const candidates = [
    resolvedPath,
    `${resolvedPath}.json`,
    path.join(resolvedPath, "tsconfig.json"),
  ];
  for (const candidate of candidates) {
    if (await hasFile(candidate)) return candidate;
  }
  return null;
};

const toDirectoryOption = (
  value: unknown,
  directory: string,
): string | undefined => (typeof value === "string" && value.length > 0 ? path.resolve(directory, value) : undefined);

const toDefinitelyTypedPackageName = (typeName: string): string => {
  if (typeName.startsWith("@types/")) return typeName;
  if (typeName.startsWith("@")) return `@types/${typeName.slice(1).replace("/", "__")}`;
  return `@types/${typeName}`;
};

const collectExtendsDependencyNames = (extendsValue: unknown): Set<string> => {
  const dependencyNames = new Set<string>();
  const specifiers = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
  for (const specifier of specifiers) {
    if (typeof specifier !== "string" || specifier.length === 0) continue;
    const packageName = getPackageNameFromSpecifier(specifier);
    if (packageName) dependencyNames.add(packageName);
  }
  return dependencyNames;
};

const collectTypeScriptConfigDependencyNames = (config: TypeScriptConfigJson): Set<string> => {
  const dependencyNames = collectExtendsDependencyNames(config.extends);
  const compilerOptions = config.compilerOptions;
  if (!compilerOptions) return dependencyNames;
  if (typeof compilerOptions.jsxImportSource === "string" && compilerOptions.jsxImportSource.length > 0) {
    dependencyNames.add(compilerOptions.jsxImportSource);
  }
  if (compilerOptions.importHelpers === true) {
    dependencyNames.add("tslib");
  }
  if (Array.isArray(compilerOptions.types)) {
    for (const typeName of compilerOptions.types) {
      if (typeof typeName === "string" && typeName.length > 0) {
        dependencyNames.add(toDefinitelyTypedPackageName(typeName));
      }
    }
  }
  if (Array.isArray(compilerOptions.plugins)) {
    for (const plugin of compilerOptions.plugins) {
      if (
        plugin &&
        typeof plugin === "object" &&
        "name" in plugin &&
        typeof plugin.name === "string" &&
        plugin.name.length > 0
      ) {
        dependencyNames.add(plugin.name);
      }
    }
  }
  return dependencyNames;
};

const readTypeScriptDirectoryOptions = async (
  tsconfigPath: string,
  visitedPaths = new Set<string>(),
): Promise<TypeScriptDirectoryOptions | null> => {
  if (visitedPaths.has(tsconfigPath)) return null;
  visitedPaths.add(tsconfigPath);
  try {
    const directory = path.dirname(tsconfigPath);
    const config = parseJsonWithComments(await fs.readFile(tsconfigPath, "utf8")) as TypeScriptConfigJson;
    const extendedPath = await resolveExtendedTypeScriptConfigPath(tsconfigPath, config.extends);
    const inheritedOptions = extendedPath
      ? await readTypeScriptDirectoryOptions(extendedPath, visitedPaths)
      : null;
    const options = {
      ...inheritedOptions,
      dependencyNames: new Set([
        ...(inheritedOptions?.dependencyNames ?? []),
        ...collectTypeScriptConfigDependencyNames(config),
      ]),
      rootDir:
        toDirectoryOption(config.compilerOptions?.rootDir, directory) ?? inheritedOptions?.rootDir,
      outDir: toDirectoryOption(config.compilerOptions?.outDir, directory) ?? inheritedOptions?.outDir,
    };
    if (options.rootDir && options.outDir) return options;
    for (const reference of config.references ?? []) {
      const referencedPath = await resolveReferencedTypeScriptConfigPath(tsconfigPath, reference.path);
      if (!referencedPath) continue;
      const referencedOptions = await readTypeScriptDirectoryOptions(referencedPath, visitedPaths);
      for (const dependencyName of referencedOptions?.dependencyNames ?? []) {
        options.dependencyNames.add(dependencyName);
      }
      options.rootDir ??= referencedOptions?.rootDir;
      options.outDir ??= referencedOptions?.outDir;
      if (options.rootDir && options.outDir) break;
    }
    return options;
  } catch {
    return null;
  }
};

const readTypeScriptSourceMaps = async (directory: string): Promise<WorkspaceSourceMap[]> => {
  const directoryOptions = await readTypeScriptDirectoryOptions(path.join(directory, "tsconfig.json"));
  if (!directoryOptions?.outDir) return [];
  const sourceDirectory =
    directoryOptions.rootDir ??
    ((await hasDirectory(path.join(directory, "src"))) ? path.join(directory, "src") : directory);
  return [
    {
      sourceDirectory,
      outputDirectory: directoryOptions.outDir,
    },
  ];
};

const readTypeScriptConfigDependencyNames = async (directory: string): Promise<Set<string>> =>
  (await readTypeScriptDirectoryOptions(path.join(directory, "tsconfig.json")))?.dependencyNames ?? new Set();

const expandSimpleWorkspacePattern = async (
  rootDirectory: string,
  pattern: string,
): Promise<string[]> => {
  const wildcardIndex = pattern.indexOf("*");
  if (wildcardIndex < 0) {
    const directory = path.resolve(rootDirectory, pattern);
    return (await hasPackageJson(directory)) ? [directory] : [];
  }

  const prefix = pattern.slice(0, wildcardIndex).replace(/\/$/, "");
  const suffix = pattern.slice(wildcardIndex + 1).replace(/^\//, "");
  const baseDirectory = path.resolve(rootDirectory, prefix || ".");
  let entries: string[];
  try {
    entries = await fs.readdir(baseDirectory);
  } catch {
    return [];
  }

  const directories: string[] = [];
  for (const entry of entries) {
    const candidateDirectory = path.join(baseDirectory, entry, suffix);
    if (await hasPackageJson(candidateDirectory)) directories.push(candidateDirectory);
  }
  return directories;
};

const isNegatedWorkspacePattern = (pattern: string): boolean => pattern.startsWith("!");

const toPositiveWorkspacePattern = (pattern: string): string =>
  isNegatedWorkspacePattern(pattern) ? pattern.slice(1) : pattern;

const isExcludedWorkspaceDirectory = (
  rootDirectory: string,
  directory: string,
  negatedPatterns: string[],
): boolean => {
  const relativeDirectory = toRelativePath(rootDirectory, directory);
  return negatedPatterns
    .map(toPositiveWorkspacePattern)
    .some(
      (pattern) =>
        matchesGlob(relativeDirectory, pattern) ||
        matchesGlob(
          `${relativeDirectory}/package.json`,
          `${pattern.replace(/\/$/, "")}/package.json`,
        ),
    );
};

const discoverWorkspaceDirectories = async (
  config: CodebaseAnalysisConfig,
  rootManifest: PackageJsonObject | null,
): Promise<string[]> => {
  const packagePatterns = toWorkspacePatternsFromPackageJson(rootManifest);
  const pnpmPatterns = await readPnpmWorkspacePatterns(config.rootDirectory);
  const patterns = [...new Set([...packagePatterns, ...pnpmPatterns])];
  const negatedPatterns = patterns.filter(isNegatedWorkspacePattern);
  const positivePatterns = patterns.filter((pattern) => !isNegatedWorkspacePattern(pattern));
  const directories = new Set<string>();

  if (await hasPackageJson(config.rootDirectory)) directories.add(config.rootDirectory);
  for (const pattern of positivePatterns) {
    for (const directory of await expandSimpleWorkspacePattern(config.rootDirectory, pattern)) {
      if (isExcludedWorkspaceDirectory(config.rootDirectory, directory, negatedPatterns)) continue;
      directories.add(directory);
    }
  }

  return [...directories].sort((first, second) => first.localeCompare(second));
};

export const discoverWorkspaces = async (
  config: CodebaseAnalysisConfig,
): Promise<WorkspaceInfo[]> => {
  const rootManifest = await readPackageJson(config.rootDirectory);
  const directories = await discoverWorkspaceDirectories(config, rootManifest);
  const workspaces: WorkspaceInfo[] = [];

  for (const directory of directories) {
    const manifest = await readPackageJson(directory);
    if (!manifest) continue;
    const dependencyBuckets = createDependencyBuckets(manifest);
    const dependencyNames = collectDependencyNames(dependencyBuckets);
    const relativeDirectory = toRelativePath(config.rootDirectory, directory) || ".";
    workspaces.push({
      id: workspaces.length,
      name: manifest.name ?? relativeDirectory,
      directory,
      relativeDirectory,
      packageJsonPath: path.join(directory, PACKAGE_JSON_FILENAME),
      manifest,
      dependencyBuckets,
      dependencyNames,
      manifestDependencyNames: collectManifestDependencyNames(manifest, dependencyNames),
      scriptDependencyNames: collectScriptDependencyNames(manifest, dependencyNames),
      typeScriptConfigDependencyNames: await readTypeScriptConfigDependencyNames(directory),
      sourceMaps: await readTypeScriptSourceMaps(directory),
    });
  }

  if (workspaces.length > 0) return workspaces;
  const fallbackManifest = rootManifest ?? {};
  const dependencyBuckets = createDependencyBuckets(fallbackManifest);
  const dependencyNames = collectDependencyNames(dependencyBuckets);
  return [
    {
      id: 0,
      name: path.basename(config.rootDirectory),
      directory: config.rootDirectory,
      relativeDirectory: ".",
      packageJsonPath: path.join(config.rootDirectory, PACKAGE_JSON_FILENAME),
      manifest: fallbackManifest,
      dependencyBuckets,
      dependencyNames,
      manifestDependencyNames: collectManifestDependencyNames(fallbackManifest, dependencyNames),
      scriptDependencyNames: collectScriptDependencyNames(fallbackManifest, dependencyNames),
      typeScriptConfigDependencyNames: await readTypeScriptConfigDependencyNames(config.rootDirectory),
      sourceMaps: await readTypeScriptSourceMaps(config.rootDirectory),
    },
  ];
};

export const findWorkspaceForFile = (
  workspaces: WorkspaceInfo[],
  filePath: string,
): WorkspaceInfo => {
  const matchingWorkspace = [...workspaces]
    .sort((first, second) => second.directory.length - first.directory.length)
    .find((workspace) => {
      const relativePath = path.relative(workspace.directory, filePath);
      return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
      );
    });
  return matchingWorkspace ?? workspaces[0];
};
