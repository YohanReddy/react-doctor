import path from "node:path";
import { ResolverFactory } from "oxc-resolver";
import {
  ASSET_FILE_EXTENSIONS,
  DEFAULT_CONDITION_NAMES,
  RESOLVE_EXTENSIONS,
  SOURCE_FILE_EXTENSIONS,
  TYPESCRIPT_DECLARATION_EXTENSIONS,
} from "./constants.js";
import { collectManifestEntrySpecifiers } from "./manifest.js";
import {
  getPackageNameFromSpecifier,
  isUrlLikeSpecifier,
  matchesGlob,
  toPortablePath,
  toRelativePath,
} from "./path-utils.js";
import type { CodebasePluginResult } from "./plugins/types.js";
import type { CodebaseModule, ResolvedImport, ResolvedModule, WorkspaceInfo } from "./types.js";

const createResolver = (): ResolverFactory =>
  new ResolverFactory({
    tsconfig: "auto",
    conditionNames: DEFAULT_CONDITION_NAMES,
    extensions: RESOLVE_EXTENSIONS,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    },
    mainFields: ["module", "browser", "main"],
    builtinModules: true,
    symlinks: false,
  });

const isInsideRoot = (rootDirectory: string, filePath: string): boolean => {
  const relativePath = path.relative(rootDirectory, filePath);
  return Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const isNodeModulePath = (filePath: string): boolean =>
  filePath.split(path.sep).includes("node_modules");

const getKnownAssetExtension = (specifier: string): string | null => {
  const lowerSpecifier = specifier.toLowerCase();
  const extension = [...ASSET_FILE_EXTENSIONS]
    .sort((first, second) => second.length - first.length)
    .find((item) => lowerSpecifier.endsWith(item));
  return extension ?? null;
};

const isKnownAssetSpecifier = (specifier: string): boolean =>
  Boolean(getKnownAssetExtension(specifier));

const findWorkspacePackageTarget = (
  sourceFilePaths: ReadonlyMap<string, number>,
  workspaces: WorkspaceInfo[],
  packageName: string | null,
  importSource: string,
): string | null => {
  if (!packageName) return null;
  const workspace = workspaces.find((item) => item.name === packageName);
  if (!workspace) return null;
  const subpath = importSource === packageName ? "" : importSource.slice(packageName.length + 1);
  const exportTargets =
    subpath.length > 0
      ? collectManifestExportTargets(workspace.manifest.exports, `./${subpath}`)
      : [];
  const relativeCandidates =
    subpath.length > 0
      ? [...exportTargets, subpath, path.join("src", subpath)]
      : [
          ...collectManifestEntrySpecifiers(workspace.manifest),
          "src/index",
          "index",
          "src/main",
          "main",
        ];
  const candidates = relativeCandidates.flatMap((candidate) =>
    toWorkspaceSourceCandidates(workspace.directory, candidate),
  );
  return findExistingSourcePath(sourceFilePaths, candidates, [workspace]);
};

const collectManifestExportTargets = (exportsField: unknown, exportKey: string): string[] => {
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) return [];
  const exportValue = (exportsField as Record<string, unknown>)[exportKey];
  return [
    ...collectStringValues(exportValue),
    ...collectWildcardManifestExportTargets(exportsField as Record<string, unknown>, exportKey),
  ].filter((value) => value.startsWith(".") || value.startsWith("/"));
};

const collectWildcardManifestExportTargets = (
  exportsField: Record<string, unknown>,
  exportKey: string,
): string[] => {
  const targets: string[] = [];
  for (const [pattern, value] of Object.entries(exportsField)) {
    if (!pattern.includes("*")) continue;
    const matchedValue = matchWildcardExportKey(pattern, exportKey);
    if (matchedValue === null) continue;
    targets.push(
      ...collectStringValues(value).map((target) => target.replaceAll("*", matchedValue)),
    );
  }
  return targets;
};

const matchWildcardExportKey = (pattern: string, exportKey: string): string | null => {
  const wildcardIndex = pattern.indexOf("*");
  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) return null;
  return exportKey.slice(prefix.length, exportKey.length - suffix.length);
};

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  return Object.values(value).flatMap(collectStringValues);
};

const toWorkspaceSourceCandidates = (workspaceDirectory: string, candidate: string): string[] => {
  const absolutePath = path.resolve(workspaceDirectory, candidate);
  const extension = path.extname(absolutePath);
  if (extension) return [absolutePath, ...toIndexCandidates(absolutePath)];
  return [
    absolutePath,
    ...SOURCE_FILE_EXTENSIONS.map((sourceExtension) => `${absolutePath}${sourceExtension}`),
    ...toIndexCandidates(absolutePath),
  ];
};

const toIndexCandidates = (absolutePath: string): string[] =>
  SOURCE_FILE_EXTENSIONS.map((sourceExtension) =>
    path.join(absolutePath, `index${sourceExtension}`),
  );

const findExistingSourcePath = (
  sourceFilePaths: ReadonlyMap<string, number>,
  candidates: string[],
  workspaces: readonly WorkspaceInfo[] = [],
): string | null => {
  for (const candidate of candidates) {
    if (sourceFilePaths.has(candidate)) return candidate;
    const sourceMappedTargetPath = findSourceMappedTarget(sourceFilePaths, candidate, workspaces);
    if (sourceMappedTargetPath) return sourceMappedTargetPath;
  }
  return null;
};

const stripCompiledExtension = (filePath: string): string => {
  const declarationExtension = TYPESCRIPT_DECLARATION_EXTENSIONS.find((extension) =>
    filePath.endsWith(extension),
  );
  if (declarationExtension) return filePath.slice(0, -declarationExtension.length);
  const extension = path.extname(filePath);
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return filePath.slice(0, -extension.length);
  }
  return filePath;
};

const toConventionalSourceMappedPath = (filePath: string): string | null => {
  const distSegment = `${path.sep}dist${path.sep}`;
  if (!filePath.includes(distSegment)) return null;
  const sourcePath = filePath.replace(distSegment, `${path.sep}src${path.sep}`);
  return stripCompiledExtension(sourcePath);
};

const isUnderDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const toConfiguredSourceMappedPath = (
  filePath: string,
  workspaces: readonly WorkspaceInfo[],
): string | null => {
  const sourceMap = workspaces
    .flatMap((workspace) => workspace.sourceMaps)
    .sort((first, second) => second.outputDirectory.length - first.outputDirectory.length)
    .find((item) => isUnderDirectory(filePath, item.outputDirectory));
  if (!sourceMap) return null;
  return stripCompiledExtension(
    path.join(sourceMap.sourceDirectory, path.relative(sourceMap.outputDirectory, filePath)),
  );
};

const findSourceMappedTarget = (
  sourceFilePaths: ReadonlyMap<string, number>,
  filePath: string,
  workspaces: readonly WorkspaceInfo[] = [],
): string | null => {
  const sourceMappedBasePath =
    toConfiguredSourceMappedPath(filePath, workspaces) ?? toConventionalSourceMappedPath(filePath);
  if (!sourceMappedBasePath) return null;
  const candidates = [
    sourceMappedBasePath,
    `${sourceMappedBasePath}.mts`,
    `${sourceMappedBasePath}.cts`,
    `${sourceMappedBasePath}.ts`,
    `${sourceMappedBasePath}.tsx`,
    `${sourceMappedBasePath}.mjs`,
    `${sourceMappedBasePath}.cjs`,
    `${sourceMappedBasePath}.js`,
    `${sourceMappedBasePath}.jsx`,
  ];
  return candidates.find((candidate) => sourceFilePaths.has(candidate)) ?? null;
};

const isVirtualOrGeneratedImport = (
  importSource: string,
  pluginResult: CodebasePluginResult | undefined,
): boolean =>
  Boolean(
    pluginResult &&
    (pluginResult.virtualModulePrefixes.some((prefix) => importSource.startsWith(prefix)) ||
      pluginResult.generatedImportSuffixes.some((suffix) => importSource.endsWith(suffix))),
  );

interface NormalizedSpecifier {
  resource: string;
  loaderPackageNames: string[];
}

const stripResourceQuery = (specifier: string): string => {
  const queryIndex = specifier.search(/[?#]/);
  return queryIndex >= 0 ? specifier.slice(0, queryIndex) : specifier;
};

const normalizeLoaderName = (loader: string): string | null => {
  const normalizedLoader = loader.replace(/^[-!]+/, "").trim();
  return getPackageNameFromSpecifier(normalizedLoader);
};

const normalizeBundlerSpecifier = (specifier: string): NormalizedSpecifier => {
  const parts = specifier.split("!");
  const resource = stripResourceQuery(parts.at(-1) ?? specifier);
  return {
    resource,
    loaderPackageNames: parts
      .slice(0, -1)
      .map(normalizeLoaderName)
      .filter((packageName): packageName is string => Boolean(packageName)),
  };
};

const toExternalPackageImport = (
  importRecord: CodebaseModule["imports"][number],
  packageName: string,
): ResolvedImport => ({
  importRecord,
  targetKind: "external",
  targetFilePath: null,
  packageName,
  error: null,
});

const toContextGlobPattern = (
  rootDirectory: string,
  module: CodebaseModule,
  importRecord: CodebaseModule["imports"][number],
): string => {
  if (importRecord.context?.kind === "require-context") {
    const baseDirectory = getContextBaseDirectory(rootDirectory, module, importRecord);
    return path.join(baseDirectory, importRecord.context.recursive === false ? "*" : "**/*");
  }
  if (importRecord.source.startsWith("/")) {
    return path.join(rootDirectory, importRecord.source.slice(1));
  }
  return path.resolve(path.dirname(module.file.filePath), importRecord.source);
};

const getContextBaseDirectory = (
  rootDirectory: string,
  module: CodebaseModule,
  importRecord: CodebaseModule["imports"][number],
): string => {
  if (importRecord.context?.kind === "require-context") {
    return path.resolve(path.dirname(module.file.filePath), importRecord.source);
  }
  if (importRecord.source.startsWith("/")) return rootDirectory;
  return path.dirname(path.resolve(path.dirname(module.file.filePath), importRecord.source));
};

const createContextRegex = (importRecord: CodebaseModule["imports"][number]): RegExp | null => {
  const pattern = importRecord.context?.regexPattern;
  if (!pattern) return null;
  try {
    return new RegExp(pattern, importRecord.context?.regexFlags ?? "");
  } catch {
    return null;
  }
};

const matchesContextRegex = (
  rootDirectory: string,
  module: CodebaseModule,
  filePath: string,
  importRecord: CodebaseModule["imports"][number],
): boolean => {
  const regex = createContextRegex(importRecord);
  if (!regex) return true;
  const baseDirectory = getContextBaseDirectory(rootDirectory, module, importRecord);
  const importerRelativePath = toRelativePath(baseDirectory, filePath);
  return regex.test(`./${importerRelativePath}`);
};

const resolveContextImports = (
  module: CodebaseModule,
  rootDirectory: string,
  sourceFilePaths: ReadonlyMap<string, number>,
  importRecord: CodebaseModule["imports"][number],
): ResolvedImport[] => {
  const globPattern = toPortablePath(toContextGlobPattern(rootDirectory, module, importRecord));
  return [...sourceFilePaths.keys()]
    .filter((filePath) => matchesGlob(toPortablePath(filePath), globPattern))
    .filter((filePath) => matchesContextRegex(rootDirectory, module, filePath, importRecord))
    .map((filePath) => ({
      importRecord,
      targetKind: "internal",
      targetFilePath: filePath,
      packageName: null,
      error: null,
    }));
};

const resolveImport = (
  module: CodebaseModule,
  resolver: ResolverFactory,
  rootDirectory: string,
  sourceFilePaths: ReadonlyMap<string, number>,
  workspaces: WorkspaceInfo[],
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
  importRecord: CodebaseModule["imports"][number],
): ResolvedImport => {
  const normalizedSpecifier = normalizeBundlerSpecifier(importRecord.source);
  const importSource = normalizedSpecifier.resource;
  const packageName = getPackageNameFromSpecifier(importSource);
  const pluginResult = pluginResults.get(module.file.workspaceId);
  if (isUrlLikeSpecifier(importSource)) {
    return {
      importRecord,
      targetKind: "asset",
      targetFilePath: null,
      packageName: null,
      error: null,
    };
  }
  if (isKnownAssetSpecifier(importSource)) {
    return {
      importRecord,
      targetKind: packageName ? "external" : "asset",
      targetFilePath: packageName
        ? null
        : path.resolve(path.dirname(module.file.filePath), importSource),
      packageName,
      error: null,
    };
  }
  if (isVirtualOrGeneratedImport(importSource, pluginResult)) {
    return {
      importRecord,
      targetKind: "asset",
      targetFilePath: null,
      packageName,
      error: null,
    };
  }
  const result = resolver.resolveFileSync(module.file.filePath, importSource);

  if (result.builtin) {
    return {
      importRecord,
      targetKind: "builtin",
      targetFilePath: null,
      packageName,
      error: null,
    };
  }

  if (result.path) {
    const resolvedPath = path.resolve(result.path);
    const sourceMappedTargetPath = findSourceMappedTarget(
      sourceFilePaths,
      resolvedPath,
      workspaces,
    );
    const internalTargetPath = sourceFilePaths.has(resolvedPath)
      ? resolvedPath
      : sourceMappedTargetPath;
    if (internalTargetPath) {
      return {
        importRecord,
        targetKind: "internal",
        targetFilePath: internalTargetPath,
        packageName,
        error: null,
      };
    }
    return {
      importRecord,
      targetKind:
        isInsideRoot(rootDirectory, resolvedPath) && !isNodeModulePath(resolvedPath)
          ? "asset"
          : "external",
      targetFilePath: resolvedPath,
      packageName,
      error: null,
    };
  }

  const workspaceTargetPath = findWorkspacePackageTarget(
    sourceFilePaths,
    workspaces,
    packageName,
    importSource,
  );
  if (workspaceTargetPath) {
    return {
      importRecord,
      targetKind: "internal",
      targetFilePath: workspaceTargetPath,
      packageName,
      error: null,
    };
  }

  if (packageName) {
    return toExternalPackageImport(importRecord, packageName);
  }

  return {
    importRecord,
    targetKind: "unresolved",
    targetFilePath: null,
    packageName,
    error: result.error ?? "Unable to resolve import.",
  };
};

const resolveImportRecords = (
  module: CodebaseModule,
  resolver: ResolverFactory,
  rootDirectory: string,
  sourceFilePaths: ReadonlyMap<string, number>,
  workspaces: WorkspaceInfo[],
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
  importRecord: CodebaseModule["imports"][number],
): ResolvedImport[] => {
  if (importRecord.kind === "context") {
    return resolveContextImports(module, rootDirectory, sourceFilePaths, importRecord);
  }
  const normalizedSpecifier = normalizeBundlerSpecifier(importRecord.source);
  return [
    ...normalizedSpecifier.loaderPackageNames.map((packageName) =>
      toExternalPackageImport(importRecord, packageName),
    ),
    resolveImport(
      module,
      resolver,
      rootDirectory,
      sourceFilePaths,
      workspaces,
      pluginResults,
      importRecord,
    ),
  ];
};

export const resolveModules = (
  rootDirectory: string,
  modules: CodebaseModule[],
  workspaces: WorkspaceInfo[],
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
): ResolvedModule[] => {
  const resolver = createResolver();
  const sourceFilePaths = new Map(modules.map((module) => [module.file.filePath, module.file.id]));

  return modules.map((module) => ({
    module,
    imports: module.imports.flatMap((importRecord) =>
      resolveImportRecords(
        module,
        resolver,
        rootDirectory,
        sourceFilePaths,
        workspaces,
        pluginResults,
        importRecord,
      ),
    ),
  }));
};
