import type { CodebasePluginResult } from "./plugins/types.js";

export interface CodebaseAnalysisOptions {
  rootDirectory: string;
  includePaths?: string[];
  excludePatterns?: string[];
  signal?: AbortSignal;
}

export interface CodebaseAnalysisConfig {
  rootDirectory: string;
  includePaths: string[];
  excludePatterns: string[];
  conditionNames: string[];
  production: boolean;
}

export interface PackageJsonObject {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, string | false>;
  source?: string;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  imports?: unknown;
  files?: string[];
  sideEffects?: boolean | string[];
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  [key: string]: unknown;
}

export interface DependencyBuckets {
  dependencies: Map<string, string>;
  devDependencies: Map<string, string>;
  peerDependencies: Map<string, string>;
  optionalDependencies: Map<string, string>;
}

export interface WorkspaceSourceMap {
  sourceDirectory: string;
  outputDirectory: string;
}

export interface WorkspaceInfo {
  id: number;
  name: string;
  directory: string;
  relativeDirectory: string;
  packageJsonPath: string;
  manifest: PackageJsonObject;
  dependencyBuckets: DependencyBuckets;
  dependencyNames: Set<string>;
  manifestDependencyNames: Set<string>;
  scriptDependencyNames: Set<string>;
  typeScriptConfigDependencyNames: Set<string>;
  sourceMaps: WorkspaceSourceMap[];
}

export interface ProjectFile {
  id: number;
  filePath: string;
  relativePath: string;
  extension: string;
  sourceText: string;
  workspaceId: number;
  lineStarts: number[];
}

export interface DiscoveredSourceFile {
  filePath: string;
  relativePath: string;
  extension: string;
  sourceText: string;
}

export interface SourcePosition {
  line: number;
  column: number;
}

export interface ImportedBinding {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  isNamespace: boolean;
  start: number;
  end: number;
}

export interface ImportRecord {
  source: string;
  bindings: ImportedBinding[];
  kind:
    | "static"
    | "dynamic"
    | "comment"
    | "re-export"
    | "require"
    | "require-resolve"
    | "import-meta"
    | "context"
    | "asset";
  context?: ContextImportOptions;
  isTypeOnly: boolean;
  isSideEffectOnly: boolean;
  isOptional: boolean;
  start: number;
  end: number;
  position: SourcePosition;
}

export interface ContextImportOptions {
  kind: "glob" | "require-context";
  recursive?: boolean;
  regexPattern?: string;
  regexFlags?: string;
}

export interface ExportMemberRecord {
  name: string;
  kind: "class" | "enum" | "namespace";
  start: number;
  end: number;
  position: SourcePosition;
  jsDocTags: Set<string>;
  hasLocalReferences: boolean;
}

export interface ExportRecord {
  exportedName: string;
  localName: string | null;
  source: string | null;
  importedName: string | null;
  symbolKind: "value" | "type" | "interface" | "enum" | "class" | "namespace" | "unknown";
  isTypeOnly: boolean;
  isReExport: boolean;
  isCommonJs: boolean;
  isNamespace: boolean;
  isReactComponentLike: boolean;
  jsDocTags: Set<string>;
  members: ExportMemberRecord[];
  hasLocalReferences: boolean;
  start: number;
  end: number;
  position: SourcePosition;
}

export interface NamespaceMemberReference {
  namespace: string;
  memberName: string;
  memberPath: string[];
}

export interface MemberObjectReference {
  namespace: string;
  memberPath: string[];
}

export interface NamespaceObjectAlias {
  exportName: string;
  propertyName: string;
  namespaceLocalName: string;
}

export interface NamespaceLocalAlias {
  aliasName: string;
  namespaceLocalName: string;
}

export interface NamespaceLocalObjectAlias {
  objectLocalName: string;
  propertyName: string;
  namespaceLocalName: string;
}

export interface CodebaseModule {
  file: ProjectFile;
  imports: ImportRecord[];
  exports: ExportRecord[];
  directives: Set<string>;
  usedIdentifiers: Set<string>;
  namespaceMemberReferences: NamespaceMemberReference[];
  memberObjectReferences: MemberObjectReference[];
  namespaceObjectAliases: NamespaceObjectAlias[];
  namespaceLocalAliases: NamespaceLocalAlias[];
  namespaceLocalObjectAliases: NamespaceLocalObjectAlias[];
  cjsExportNames: Set<string>;
  parseErrors: string[];
}

export interface ResolvedImport {
  importRecord: ImportRecord;
  targetKind: "internal" | "external" | "builtin" | "asset" | "unresolved";
  targetFilePath: string | null;
  packageName: string | null;
  error: string | null;
}

export interface ResolvedModule {
  module: CodebaseModule;
  imports: ResolvedImport[];
}

export interface SymbolReference {
  fromFileId: number;
  kind:
    | "named"
    | "default"
    | "namespace"
    | "namespace-member"
    | "re-export"
    | "dynamic"
    | "side-effect";
  importRecord: ImportRecord;
}

export interface GraphExportSymbol extends ExportRecord {
  references: SymbolReference[];
  isPluginUsed: boolean;
  isReferencedByNamespace: boolean;
  referencedMemberNames: Set<string>;
}

export interface ModuleGraphNode {
  file: ProjectFile;
  imports: ResolvedImport[];
  importedBy: Set<number>;
  exports: Map<string, GraphExportSymbol>;
  directives: Set<string>;
  parseErrors: string[];
  usedIdentifiers: Set<string>;
  namespaceMemberReferences: NamespaceMemberReference[];
  memberObjectReferences: MemberObjectReference[];
  namespaceObjectAliases: NamespaceObjectAlias[];
  namespaceLocalAliases: NamespaceLocalAlias[];
  namespaceLocalObjectAliases: NamespaceLocalObjectAlias[];
  entryRoles: Set<EntryPointRole>;
  entrySources: Set<string>;
  isReachable: boolean;
  isRuntimeReachable: boolean;
  isTestReachable: boolean;
  isTypeReachable: boolean;
  hasCjsExports: boolean;
}

export interface EntryPoint {
  fileId: number;
  role: EntryPointRole;
  source: string;
}

export interface PackageUsage {
  packageName: string;
  workspaceId: number;
  fromFileId: number;
  specifier: string;
  isTypeOnly: boolean;
  isRuntime: boolean;
  isTestOnly: boolean;
}

export interface ModuleGraph {
  rootDirectory: string;
  config: CodebaseAnalysisConfig;
  workspaces: WorkspaceInfo[];
  files: ProjectFile[];
  nodes: Map<number, ModuleGraphNode>;
  pathToFileId: Map<string, number>;
  entryPoints: EntryPoint[];
  packageUsages: PackageUsage[];
  unresolvedImports: ResolvedImport[];
  pluginResults: ReadonlyMap<number, CodebasePluginResult>;
}

export interface CodebaseAnalysisResult {
  graph: ModuleGraph;
}

export type EntryPointRole = "runtime" | "test" | "support";
