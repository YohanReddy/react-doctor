import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  IGNORED_DIRECTORY_NAMES,
  PACKAGE_JSON_FILENAME,
  SOURCE_FILE_EXTENSIONS,
} from "./rules/codebase/analyzer/constants.js";
import { readPackageJson } from "./rules/codebase/analyzer/manifest.js";
import type { PackageJsonObject } from "./rules/codebase/analyzer/index.js";
import type { ReactDoctorOxlintFramework, ReactDoctorOxlintProjectInfo } from "./rules/index.js";
import type { ReactProjectFramework, ReactProjectInfo } from "./types.js";

interface DependencyInfo {
  reactVersion: string | null;
  reactPeerDependencyRange: string | null;
  tailwindVersion: string | null;
  framework: ReactProjectFramework;
  hasReactCompiler: boolean;
  hasTanStackAI: boolean;
  hasTanStackQuery: boolean;
}

interface PackageInfo {
  manifest: PackageJsonObject | null;
  packageJsonPath: string | null;
  catalogs: CatalogInfo;
}

interface SourceFileInfo {
  count: number;
  hasTypeScript: boolean;
}

interface CatalogInfo {
  defaultVersions: Map<string, string>;
  groupedVersions: Map<string, Map<string, string>>;
}

const FRAMEWORK_PACKAGES: Record<string, ReactProjectFramework> = {
  "@remix-run/react": "remix",
  "@tanstack/react-start": "tanstack-start",
  expo: "expo",
  gatsby: "gatsby",
  next: "nextjs",
  "react-native": "react-native",
  "react-scripts": "cra",
  vite: "vite",
};

const REACT_COMPILER_PACKAGES: ReadonlySet<string> = new Set([
  "babel-plugin-react-compiler",
  "eslint-plugin-react-compiler",
  "react-compiler-runtime",
]);

const TANSTACK_AI_PACKAGES: ReadonlySet<string> = new Set([
  "@tanstack/ai",
  "@tanstack/ai-code-mode",
]);

const TANSTACK_QUERY_PACKAGES: ReadonlySet<string> = new Set([
  "@tanstack/query-core",
  "@tanstack/react-query",
  "react-query",
]);

const SOURCE_FILE_EXTENSION_SET: ReadonlySet<string> = new Set(SOURCE_FILE_EXTENSIONS);

const createEmptyCatalogInfo = (): CatalogInfo => ({
  defaultVersions: new Map(),
  groupedVersions: new Map(),
});

const isSourceFileName = (fileName: string): boolean =>
  SOURCE_FILE_EXTENSION_SET.has(path.extname(fileName));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addCatalogVersions = (target: Map<string, string>, value: unknown): void => {
  if (!isRecord(value)) return;
  for (const [packageName, version] of Object.entries(value)) {
    if (typeof version === "string") target.set(packageName, version);
  }
};

const addGroupedCatalogVersions = (catalogs: CatalogInfo, value: unknown): void => {
  if (!isRecord(value)) return;
  for (const [catalogName, entries] of Object.entries(value)) {
    const versions = catalogs.groupedVersions.get(catalogName) ?? new Map<string, string>();
    addCatalogVersions(versions, entries);
    catalogs.groupedVersions.set(catalogName, versions);
  }
};

const mergeManifestCatalogs = (catalogs: CatalogInfo, manifest: PackageJsonObject | null): void => {
  if (!manifest) return;
  addCatalogVersions(catalogs.defaultVersions, manifest.catalog);
  addGroupedCatalogVersions(catalogs, manifest.catalogs);
  const workspaces: unknown = manifest.workspaces;
  if (isRecord(workspaces)) {
    addCatalogVersions(catalogs.defaultVersions, workspaces.catalog);
    addGroupedCatalogVersions(catalogs, workspaces.catalogs);
  }
};

const collectAncestorCatalogs = async (rootDirectory: string): Promise<CatalogInfo> => {
  const catalogs = createEmptyCatalogInfo();
  let currentDirectory = rootDirectory;
  while (true) {
    mergeManifestCatalogs(catalogs, await readPackageJson(currentDirectory));
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return catalogs;
    currentDirectory = parentDirectory;
  }
};

const readNearestPackageInfo = async (rootDirectory: string): Promise<PackageInfo> => {
  const catalogs = await collectAncestorCatalogs(rootDirectory);
  let currentDirectory = rootDirectory;
  while (true) {
    const manifest = await readPackageJson(currentDirectory);
    if (manifest) {
      return {
        manifest,
        packageJsonPath: path.join(currentDirectory, PACKAGE_JSON_FILENAME),
        catalogs,
      };
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return { manifest: null, packageJsonPath: null, catalogs };
    }
    currentDirectory = parentDirectory;
  }
};

const collectDependencies = (manifest: PackageJsonObject | null): Map<string, string> =>
  new Map(
    [
      ...Object.entries(manifest?.peerDependencies ?? {}),
      ...Object.entries(manifest?.dependencies ?? {}),
      ...Object.entries(manifest?.devDependencies ?? {}),
      ...Object.entries(manifest?.optionalDependencies ?? {}),
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

const hasAnyDependency = (
  dependencies: ReadonlyMap<string, string>,
  packageNames: ReadonlySet<string>,
): boolean => {
  for (const packageName of packageNames) {
    if (dependencies.has(packageName)) return true;
  }
  return false;
};

const detectFramework = (dependencies: ReadonlyMap<string, string>): ReactProjectFramework => {
  for (const [packageName, framework] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies.has(packageName)) return framework;
  }
  return dependencies.has("react") ? "react" : "unknown";
};

const toResolvedDependencyVersion = (
  packageName: string,
  version: string | null | undefined,
  catalogs: CatalogInfo,
): string | null => {
  if (!version) return null;
  if (version.startsWith("catalog:")) {
    const catalogName = version.slice("catalog:".length);
    if (!catalogName) return catalogs.defaultVersions.get(packageName) ?? null;
    return catalogs.groupedVersions.get(catalogName)?.get(packageName) ?? null;
  }
  if (version.startsWith("workspace:")) return null;
  return version;
};

export const parseReactMajorVersion = (version: string | null): number | null => {
  if (!version) return null;
  const match = version.match(/\d+/);
  if (!match) return null;
  return Number.parseInt(match[0], 10);
};

const getDependencyInfo = (packageInfo: PackageInfo): DependencyInfo => {
  const { catalogs, manifest } = packageInfo;
  const dependencies = collectDependencies(manifest);
  const reactVersion = toResolvedDependencyVersion("react", dependencies.get("react"), catalogs);
  return {
    reactVersion,
    reactPeerDependencyRange:
      typeof manifest?.peerDependencies?.react === "string"
        ? manifest.peerDependencies.react
        : null,
    tailwindVersion: toResolvedDependencyVersion(
      "tailwindcss",
      dependencies.get("tailwindcss"),
      catalogs,
    ),
    framework: detectFramework(dependencies),
    hasReactCompiler: hasAnyDependency(dependencies, REACT_COMPILER_PACKAGES),
    hasTanStackAI: hasAnyDependency(dependencies, TANSTACK_AI_PACKAGES),
    hasTanStackQuery: hasAnyDependency(dependencies, TANSTACK_QUERY_PACKAGES),
  };
};

const collectSourceFileInfo = async (rootDirectory: string): Promise<SourceFileInfo> => {
  const sourceFileInfo: SourceFileInfo = {
    count: 0,
    hasTypeScript: false,
  };
  const directories = [rootDirectory];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          directories.push(path.join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && isSourceFileName(entry.name)) {
        sourceFileInfo.count++;
        sourceFileInfo.hasTypeScript ||= /\.(cts|mts|ts|tsx)$/.test(entry.name);
      }
    }
  }

  return sourceFileInfo;
};

export const toOxlintProjectInfo = (project: ReactProjectInfo): ReactDoctorOxlintProjectInfo => {
  const framework: ReactDoctorOxlintFramework =
    project.framework === "nextjs" ||
    project.framework === "expo" ||
    project.framework === "react-native" ||
    project.framework === "tanstack-start"
      ? project.framework
      : "react";

  return {
    framework,
    hasReactCompiler: project.hasReactCompiler,
    hasTanStackAI: project.hasTanStackAI,
    hasTanStackQuery: project.hasTanStackQuery,
    hasTypeScript: project.hasTypeScript,
    reactMajorVersion: project.reactMajorVersion,
    reactPeerDependencyRange: project.reactPeerDependencyRange,
    tailwindVersion: project.tailwindVersion,
  };
};

export const discoverReactProject = async (rootDirectory: string): Promise<ReactProjectInfo> => {
  const resolvedRootDirectory = path.resolve(rootDirectory);
  const packageInfo = await readNearestPackageInfo(resolvedRootDirectory);
  const dependencyInfo = getDependencyInfo(packageInfo);
  const sourceFileInfo = await collectSourceFileInfo(resolvedRootDirectory);

  return {
    rootDirectory: resolvedRootDirectory,
    projectName: packageInfo.manifest?.name ?? path.basename(resolvedRootDirectory),
    packageJsonPath: packageInfo.packageJsonPath,
    reactVersion: dependencyInfo.reactVersion,
    reactMajorVersion: parseReactMajorVersion(dependencyInfo.reactVersion),
    reactPeerDependencyRange: dependencyInfo.reactPeerDependencyRange,
    tailwindVersion: dependencyInfo.tailwindVersion,
    framework: dependencyInfo.framework,
    hasTypeScript: sourceFileInfo.hasTypeScript,
    hasReactCompiler: dependencyInfo.hasReactCompiler,
    hasTanStackAI: dependencyInfo.hasTanStackAI,
    hasTanStackQuery: dependencyInfo.hasTanStackQuery,
    sourceFileCount: sourceFileInfo.count,
  };
};
