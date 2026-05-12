import { createCodebaseAnalysisConfig } from "./config.js";
import { discoverSourceFiles } from "./discovery.js";
import { discoverEntryPoints } from "./entrypoints.js";
import { extractModules } from "./extract/index.js";
import { buildModuleGraph } from "./graph.js";
import { runCodebasePlugins } from "./plugins/index.js";
import { resolveModules } from "./resolve.js";
import { discoverWorkspaces } from "./workspace.js";
import type { CodebaseAnalysisOptions, CodebaseAnalysisResult } from "./types.js";

export type {
  CodebaseAnalysisOptions,
  CodebaseAnalysisResult,
  CodebaseModule,
  DependencyBuckets,
  DiscoveredSourceFile,
  EntryPoint,
  EntryPointRole,
  ExportMemberRecord,
  ExportRecord,
  GraphExportSymbol,
  ImportedBinding,
  ImportRecord,
  ModuleGraph,
  ModuleGraphNode,
  PackageJsonObject,
  PackageUsage,
  ProjectFile,
  ResolvedImport,
  ResolvedModule,
  SourcePosition,
  WorkspaceInfo,
} from "./types.js";

export const runCodebaseAnalysis = async (
  options: CodebaseAnalysisOptions,
): Promise<CodebaseAnalysisResult> => {
  options.signal?.throwIfAborted();
  const config = createCodebaseAnalysisConfig(options);
  const workspaces = await discoverWorkspaces(config);
  const pluginResults = runCodebasePlugins(workspaces);
  const sourceFiles = await discoverSourceFiles(config, workspaces, options.signal);
  options.signal?.throwIfAborted();
  const modules = extractModules(sourceFiles);
  options.signal?.throwIfAborted();
  const resolvedModules = resolveModules(config.rootDirectory, modules, workspaces, pluginResults);
  const entryPoints = discoverEntryPoints(config, workspaces, sourceFiles, pluginResults);
  const graph = buildModuleGraph(config, workspaces, resolvedModules, entryPoints, pluginResults);

  return { graph };
};
