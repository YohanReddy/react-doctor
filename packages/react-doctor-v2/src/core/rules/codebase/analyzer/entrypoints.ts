import path from "node:path";
import {
  COMMON_ENTRY_STEMS,
  FRAMEWORK_ROUTE_ENTRY_STEMS,
  SOURCE_FILE_EXTENSIONS,
  SUPPORT_ENTRY_PATTERNS,
  TEST_ENTRY_MARKERS,
  TYPESCRIPT_DECLARATION_EXTENSIONS,
} from "./constants.js";
import { collectManifestEntrySpecifiers, collectManifestSupportSpecifiers } from "./manifest.js";
import { getFileStem, matchesAnyGlob, toRelativePath } from "./path-utils.js";
import type {
  CodebaseAnalysisConfig,
  EntryPoint,
  EntryPointRole,
  ProjectFile,
  WorkspaceInfo,
} from "./types.js";
import type { CodebasePluginResult } from "./plugins/types.js";

const toPathLookup = (files: ProjectFile[]): Map<string, ProjectFile> =>
  new Map(files.map((file) => [file.filePath, file]));

const extensionCandidates = (specifier: string): string[] => {
  const extension = path.extname(specifier);
  if (extension) return [specifier];
  return [
    specifier,
    ...SOURCE_FILE_EXTENSIONS.map((item) => `${specifier}${item}`),
    ...SOURCE_FILE_EXTENSIONS.map((item) => path.join(specifier, `index${item}`)),
  ];
};

const SOURCE_EXTENSION_CANDIDATES: Record<string, string[]> = {
  ".cjs": [".cts", ".cjs", ".ts", ".js"],
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs", ".ts", ".js"],
};

const isUnderDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const toConfiguredSourceMappedPath = (
  filePath: string,
  workspace: WorkspaceInfo,
): string | null => {
  const sourceMap = [...workspace.sourceMaps]
    .sort((first, second) => second.outputDirectory.length - first.outputDirectory.length)
    .find((item) => isUnderDirectory(filePath, item.outputDirectory));
  if (!sourceMap) return null;
  return path.join(sourceMap.sourceDirectory, path.relative(sourceMap.outputDirectory, filePath));
};

const toConventionalSourceMappedPath = (filePath: string): string | null =>
  filePath.includes(`${path.sep}dist${path.sep}`)
    ? filePath.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
    : null;

const toSourceMappedPath = (filePath: string, workspace: WorkspaceInfo): string | null =>
  toConfiguredSourceMappedPath(filePath, workspace) ?? toConventionalSourceMappedPath(filePath);

const toAlternativeSourcePaths = (filePath: string): string[] => {
  const declarationExtension = TYPESCRIPT_DECLARATION_EXTENSIONS.find((extension) =>
    filePath.endsWith(extension),
  );
  if (declarationExtension) {
    const basePath = filePath.slice(0, -declarationExtension.length);
    return [`${basePath}.mts`, `${basePath}.cts`, `${basePath}.ts`, `${basePath}.tsx`];
  }

  const extension = path.extname(filePath);
  const sourceExtensions = SOURCE_EXTENSION_CANDIDATES[extension];
  if (!sourceExtensions) return [];
  const basePath = filePath.slice(0, -extension.length);
  return sourceExtensions.map((sourceExtension) => `${basePath}${sourceExtension}`);
};

const resolveEntrySpecifier = (
  config: CodebaseAnalysisConfig,
  workspace: WorkspaceInfo,
  filesByPath: ReadonlyMap<string, ProjectFile>,
  specifier: string,
): ProjectFile | null => {
  for (const candidate of extensionCandidates(specifier)) {
    const absolutePath = path.resolve(workspace.directory, candidate);
    const sourceMappedPath = toSourceMappedPath(absolutePath, workspace);
    const candidatePaths = new Set([
      absolutePath,
      ...toAlternativeSourcePaths(absolutePath),
      ...(sourceMappedPath
        ? [sourceMappedPath, ...toAlternativeSourcePaths(sourceMappedPath)]
        : []),
    ]);
    for (const candidatePath of candidatePaths) {
      const file = filesByPath.get(candidatePath);
      if (file) return file;
    }
  }
  const rootRelativePath = path.resolve(config.rootDirectory, specifier);
  return filesByPath.get(rootRelativePath) ?? null;
};

const isConventionalRuntimeEntry = (relativePath: string): boolean => {
  const fileStem = getFileStem(relativePath);
  const pathParts = relativePath.split("/");
  return (
    (COMMON_ENTRY_STEMS.has(fileStem) &&
      (relativePath.startsWith("src/") || pathParts.length === 1)) ||
    (FRAMEWORK_ROUTE_ENTRY_STEMS.has(fileStem) &&
      (pathParts.includes("app") || pathParts.includes("pages") || pathParts.includes("routes")))
  );
};

const isTestEntry = (relativePath: string): boolean =>
  TEST_ENTRY_MARKERS.some((marker) => relativePath.includes(marker));

const isSupportEntry = (relativePath: string): boolean =>
  matchesAnyGlob(relativePath, SUPPORT_ENTRY_PATTERNS);

const hasGlobSyntax = (value: string): boolean => value.includes("*") || value.includes("{");

const pushEntryPoint = (
  entryPoints: EntryPoint[],
  file: ProjectFile | null,
  role: EntryPointRole,
  source: string,
): void => {
  if (!file) return;
  if (entryPoints.some((entryPoint) => entryPoint.fileId === file.id && entryPoint.role === role))
    return;
  entryPoints.push({ fileId: file.id, role, source });
};

export const discoverEntryPoints = (
  config: CodebaseAnalysisConfig,
  workspaces: WorkspaceInfo[],
  files: ProjectFile[],
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
): EntryPoint[] => {
  const filesByPath = toPathLookup(files);
  const entryPoints: EntryPoint[] = [];

  for (const workspace of workspaces) {
    const manifestEntries = collectManifestEntrySpecifiers(workspace.manifest);
    for (const entry of manifestEntries) {
      pushEntryPoint(
        entryPoints,
        resolveEntrySpecifier(config, workspace, filesByPath, entry),
        "runtime",
        "package.json",
      );
    }
    const manifestSupportEntries = collectManifestSupportSpecifiers(workspace.manifest);
    for (const entry of manifestSupportEntries.filter(
      (supportEntry) => !hasGlobSyntax(supportEntry),
    )) {
      pushEntryPoint(
        entryPoints,
        resolveEntrySpecifier(config, workspace, filesByPath, entry),
        "support",
        "package.json:sideEffects",
      );
    }

    const workspaceFiles = files.filter((file) => file.workspaceId === workspace.id);
    const pluginResult = pluginResults.get(workspace.id);
    for (const file of workspaceFiles) {
      const workspaceRelativePath = toRelativePath(workspace.directory, file.filePath);
      for (const entry of manifestSupportEntries.filter(hasGlobSyntax)) {
        if (matchesAnyGlob(workspaceRelativePath, [entry.replace(/^\.\//, "")])) {
          pushEntryPoint(entryPoints, file, "support", "package.json:sideEffects");
        }
      }
      for (const entryPattern of pluginResult?.entryPatterns ?? []) {
        if (matchesAnyGlob(workspaceRelativePath, [entryPattern.pattern])) {
          pushEntryPoint(entryPoints, file, entryPattern.role, "plugin");
        }
      }
      if (isConventionalRuntimeEntry(workspaceRelativePath)) {
        pushEntryPoint(entryPoints, file, "runtime", "convention");
      }
      if (isTestEntry(workspaceRelativePath)) {
        pushEntryPoint(entryPoints, file, "test", "test-pattern");
      }
      if (isSupportEntry(workspaceRelativePath)) {
        pushEntryPoint(entryPoints, file, "support", "support-pattern");
      }
      if (pluginResult && matchesAnyGlob(workspaceRelativePath, pluginResult.alwaysUsedPatterns)) {
        pushEntryPoint(entryPoints, file, "support", "plugin-always-used");
      }
    }
  }

  return entryPoints.sort(
    (first, second) => first.fileId - second.fileId || first.role.localeCompare(second.role),
  );
};
