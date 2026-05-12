import {
  DEFINITELY_TYPED_SCOPE,
  DEPENDENCIES_CHECK_ID,
  IGNORED_DEFINITELY_TYPED_PACKAGE_NAMES,
} from "./analyzer/constants.js";
import { runCodebaseAnalysis } from "./analyzer/index.js";
import { isOptionalPeerDependency } from "./analyzer/manifest.js";
import type {
  DependencyBuckets,
  ImportRecord,
  ModuleGraph,
  ProjectFile,
  WorkspaceInfo,
} from "./analyzer/index.js";
import { defineRule } from "../registry.js";
import type { ReactDoctorIssue } from "../../types.js";

export const DEPENDENCIES_RULE_ID = DEPENDENCIES_CHECK_ID;

interface DependencyFinding {
  workspace: WorkspaceInfo;
  packageName: string;
  file?: ProjectFile;
  importRecord?: ImportRecord;
  dependencyBucket?: keyof DependencyBuckets;
  dependencyBuckets?: Array<keyof DependencyBuckets>;
  sourceKind?: "config" | "import" | "manifest" | "script";
}

interface UnresolvedImportFinding {
  file: ProjectFile;
  importRecord: ImportRecord;
  error: string;
}

const dependencyBucketNames: Array<keyof DependencyBuckets> = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const createCodebaseIssue = (
  issue: Omit<ReactDoctorIssue, "severity" | "category"> & {
    severity?: ReactDoctorIssue["severity"];
    category?: string;
  },
): ReactDoctorIssue => ({
  severity: issue.severity ?? "warning",
  category: issue.category ?? "codebase",
  ...issue,
});

const sortIssues = (issues: ReactDoctorIssue[]): ReactDoctorIssue[] =>
  issues.sort((first, second) => {
    const firstPath = first.location?.filePath ?? "";
    const secondPath = second.location?.filePath ?? "";
    return (
      firstPath.localeCompare(secondPath) ||
      (first.location?.line ?? 0) - (second.location?.line ?? 0) ||
      first.id.localeCompare(second.id)
    );
  });

const findUsage = (graph: ModuleGraph, workspace: WorkspaceInfo, packageName: string) =>
  graph.packageUsages.find(
    (usage) => usage.workspaceId === workspace.id && usage.packageName === packageName,
  );

const isDefinitelyTypedPackage = (packageName: string): boolean =>
  packageName.startsWith(`${DEFINITELY_TYPED_SCOPE}/`);

const toDefinitelyTypedPackageName = (packageName: string): string => {
  if (isDefinitelyTypedPackage(packageName)) return packageName;
  if (packageName.startsWith("@")) {
    return `${DEFINITELY_TYPED_SCOPE}/${packageName.slice(1).replace("/", "__")}`;
  }
  return `${DEFINITELY_TYPED_SCOPE}/${packageName}`;
};

const toRuntimePackageName = (typesPackageName: string): string | null => {
  if (!isDefinitelyTypedPackage(typesPackageName)) return null;
  const unscopedName = typesPackageName.slice(DEFINITELY_TYPED_SCOPE.length + 1);
  if (!unscopedName) return null;
  if (unscopedName.includes("__")) {
    const [scopeName, packageName] = unscopedName.split("__");
    return scopeName && packageName ? `@${scopeName}/${packageName}` : null;
  }
  return unscopedName;
};

const addDefinitelyTypedCompanionPackages = (
  workspace: WorkspaceInfo,
  usedPackages: Set<string>,
): void => {
  for (const packageName of [...usedPackages]) {
    if (isDefinitelyTypedPackage(packageName)) continue;
    const typesPackageName = toDefinitelyTypedPackageName(packageName);
    if (workspace.dependencyNames.has(typesPackageName)) usedPackages.add(typesPackageName);
  }
  for (const packageName of workspace.dependencyNames) {
    const runtimePackageName = toRuntimePackageName(packageName);
    if (!runtimePackageName || !IGNORED_DEFINITELY_TYPED_PACKAGE_NAMES.has(runtimePackageName)) {
      continue;
    }
    usedPackages.add(packageName);
  }
};

const getUsedPackages = (graph: ModuleGraph, workspace: WorkspaceInfo): Set<string> => {
  const usedPackages = new Set([
    ...graph.packageUsages
      .filter((usage) => usage.workspaceId === workspace.id)
      .map((usage) => usage.packageName),
    ...workspace.manifestDependencyNames,
    ...workspace.scriptDependencyNames,
    ...workspace.typeScriptConfigDependencyNames,
    ...(graph.pluginResults.get(workspace.id)?.toolingDependencies ?? []),
  ]);
  addDefinitelyTypedCompanionPackages(workspace, usedPackages);
  return usedPackages;
};

const getNonImportUsedPackages = (graph: ModuleGraph, workspace: WorkspaceInfo): Set<string> =>
  new Set([
    ...workspace.manifestDependencyNames,
    ...workspace.scriptDependencyNames,
    ...workspace.typeScriptConfigDependencyNames,
    ...(graph.pluginResults.get(workspace.id)?.toolingDependencies ?? []),
  ]);

const hasDeclaredDependency = (workspace: WorkspaceInfo, packageName: string): boolean =>
  dependencyBucketNames.some((bucketName) =>
    workspace.dependencyBuckets[bucketName].has(packageName),
  );

const getDeclaredDependencyBuckets = (
  workspace: WorkspaceInfo,
  packageName: string,
): Array<keyof DependencyBuckets> =>
  dependencyBucketNames.filter((bucketName) =>
    workspace.dependencyBuckets[bucketName].has(packageName),
  );

const createDependencyFinding = (
  graph: ModuleGraph,
  workspace: WorkspaceInfo,
  packageName: string,
  dependencyBucket?: keyof DependencyBuckets,
  sourceKind: DependencyFinding["sourceKind"] = "import",
): DependencyFinding => {
  const usage = findUsage(graph, workspace, packageName);
  const file = usage ? graph.files[usage.fromFileId] : undefined;
  const importRecord = file
    ? graph.nodes
        .get(file.id)
        ?.imports.find((resolvedImport) => resolvedImport.packageName === packageName)?.importRecord
    : undefined;
  return { workspace, packageName, file, importRecord, dependencyBucket, sourceKind };
};

const createDuplicateDependencyFinding = (
  workspace: WorkspaceInfo,
  packageName: string,
): DependencyFinding => ({
  workspace,
  packageName,
  dependencyBuckets: getDeclaredDependencyBuckets(workspace, packageName),
});

const collectDuplicateDependencyDeclarations = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.dependencyNames]
      .filter((packageName) => getDeclaredDependencyBuckets(workspace, packageName).length > 1)
      .map((packageName) => createDuplicateDependencyFinding(workspace, packageName)),
  );

const collectUnresolvedImports = (graph: ModuleGraph): UnresolvedImportFinding[] =>
  graph.unresolvedImports.flatMap((resolvedImport) => {
    const file = graph.files.find((projectFile) =>
      graph.nodes.get(projectFile.id)?.imports.includes(resolvedImport),
    );
    if (!file) return [];
    return [
      {
        file,
        importRecord: resolvedImport.importRecord,
        error: resolvedImport.error ?? "Unable to resolve import.",
      },
    ];
  });

const collectUnlistedImportDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.packageUsages
    .filter((usage) => {
      const workspace = graph.workspaces[usage.workspaceId];
      return workspace && !hasDeclaredDependency(workspace, usage.packageName);
    })
    .map((usage) => {
      const workspace = graph.workspaces[usage.workspaceId];
      return createDependencyFinding(graph, workspace, usage.packageName);
    });

const collectUnlistedManifestDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.manifestDependencyNames]
      .filter((packageName) => !hasDeclaredDependency(workspace, packageName))
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, undefined, "manifest"),
      ),
  );

const collectUnlistedScriptDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.scriptDependencyNames]
      .filter((packageName) => !hasDeclaredDependency(workspace, packageName))
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, undefined, "script"),
      ),
  );

const collectUnlistedTypeScriptConfigDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.typeScriptConfigDependencyNames]
      .filter((packageName) => !hasDeclaredDependency(workspace, packageName))
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, undefined, "config"),
      ),
  );

const collectUnlistedDependencies = (graph: ModuleGraph): DependencyFinding[] => [
  ...collectUnlistedImportDependencies(graph),
  ...collectUnlistedManifestDependencies(graph),
  ...collectUnlistedScriptDependencies(graph),
  ...collectUnlistedTypeScriptConfigDependencies(graph),
];

const collectUnusedDependencies = (
  graph: ModuleGraph,
  bucketName: keyof DependencyBuckets,
): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) => {
    const usedPackages = getUsedPackages(graph, workspace);
    return [...workspace.dependencyBuckets[bucketName].keys()]
      .filter((packageName) => !usedPackages.has(packageName))
      .map((packageName) => createDependencyFinding(graph, workspace, packageName, bucketName));
  });

const collectUnusedOptionalPeerDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.dependencyBuckets.peerDependencies.keys()]
      .filter((packageName) => isOptionalPeerDependency(workspace, packageName))
      .filter((packageName) => !getUsedPackages(graph, workspace).has(packageName))
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, "peerDependencies"),
      ),
  );

const collectUnusedPeerDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) => {
    const usedPackages = getUsedPackages(graph, workspace);
    return [...workspace.dependencyBuckets.peerDependencies.keys()]
      .filter((packageName) => !isOptionalPeerDependency(workspace, packageName))
      .filter((packageName) => !usedPackages.has(packageName))
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, "peerDependencies"),
      );
  });

const collectUnusedOptionalDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  collectUnusedDependencies(graph, "optionalDependencies");

const collectRuntimeDevDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.dependencyBuckets.devDependencies.keys()]
      .filter((packageName) => !workspace.dependencyBuckets.dependencies.has(packageName))
      .filter((packageName) =>
        graph.packageUsages.some(
          (usage) =>
            usage.workspaceId === workspace.id &&
            usage.packageName === packageName &&
            usage.isRuntime &&
            !usage.isTypeOnly,
        ),
      )
      .map((packageName) =>
        createDependencyFinding(graph, workspace, packageName, "devDependencies"),
      ),
  );

const collectTypeOnlyDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.dependencyBuckets.dependencies.keys()]
      .filter((packageName) => {
        if (getNonImportUsedPackages(graph, workspace).has(packageName)) return false;
        const usages = graph.packageUsages.filter(
          (usage) => usage.workspaceId === workspace.id && usage.packageName === packageName,
        );
        return usages.length > 0 && usages.every((usage) => usage.isTypeOnly);
      })
      .map((packageName) => createDependencyFinding(graph, workspace, packageName, "dependencies")),
  );

const collectTestOnlyDependencies = (graph: ModuleGraph): DependencyFinding[] =>
  graph.workspaces.flatMap((workspace) =>
    [...workspace.dependencyBuckets.dependencies.keys()]
      .filter((packageName) => {
        if (getNonImportUsedPackages(graph, workspace).has(packageName)) return false;
        const usages = graph.packageUsages.filter(
          (usage) => usage.workspaceId === workspace.id && usage.packageName === packageName,
        );
        return usages.length > 0 && usages.every((usage) => usage.isTestOnly);
      })
      .map((packageName) => createDependencyFinding(graph, workspace, packageName, "dependencies")),
  );

const toUnresolvedImportIssue = (finding: UnresolvedImportFinding): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEPENDENCIES_CHECK_ID}/unresolved/${finding.file.relativePath}/${finding.importRecord.source}`,
    title: "Unresolved import",
    message: `The import "${finding.importRecord.source}" could not be resolved.`,
    severity: "error",
    location: {
      filePath: finding.file.relativePath,
      line: finding.importRecord.position.line,
      column: finding.importRecord.position.column,
    },
    recommendation:
      "Fix the specifier, dependency, tsconfig path, or generated module configuration.",
    source: { checkId: DEPENDENCIES_CHECK_ID, ruleId: "unresolved-import" },
  });

const toDependencyIssue = (
  finding: DependencyFinding,
  ruleId: string,
  title: string,
  message: string,
): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEPENDENCIES_CHECK_ID}/${ruleId}/${finding.workspace.name}/${finding.packageName}`,
    title,
    message,
    location: finding.file
      ? {
          filePath: finding.file.relativePath,
          line: finding.importRecord?.position.line,
          column: finding.importRecord?.position.column,
        }
      : { filePath: finding.workspace.relativeDirectory },
    recommendation: "Update the nearest package.json dependency bucket to match actual usage.",
    source: { checkId: DEPENDENCIES_CHECK_ID, ruleId },
  });

const getUnlistedDependencyMessage = (finding: DependencyFinding): string => {
  if (finding.sourceKind === "script") {
    return `"${finding.packageName}" is used by package.json scripts but not listed in the workspace package.json.`;
  }
  if (finding.sourceKind === "manifest") {
    return `"${finding.packageName}" is referenced by package.json configuration but not listed in the workspace package.json.`;
  }
  if (finding.sourceKind === "config") {
    return `"${finding.packageName}" is referenced by tsconfig.json but not listed in the workspace package.json.`;
  }
  return `"${finding.packageName}" is imported but not listed in the workspace package.json.`;
};

const getDuplicateDependencyMessage = (finding: DependencyFinding): string =>
  `"${finding.packageName}" is declared in multiple dependency buckets: ${(finding.dependencyBuckets ?? []).join(", ")}.`;

const inspectDependencies = (graph: ModuleGraph): ReactDoctorIssue[] =>
  sortIssues([
    ...collectUnresolvedImports(graph).map(toUnresolvedImportIssue),
    ...collectDuplicateDependencyDeclarations(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "duplicate-dependency-declaration",
        "Duplicate dependency declaration",
        getDuplicateDependencyMessage(finding),
      ),
    ),
    ...collectUnlistedDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "unlisted-dependency",
        "Unlisted dependency",
        getUnlistedDependencyMessage(finding),
      ),
    ),
    ...collectUnusedDependencies(graph, "dependencies").map((finding) =>
      toDependencyIssue(
        finding,
        "unused-dependency",
        "Unused dependency",
        `"${finding.packageName}" is listed in dependencies but not used.`,
      ),
    ),
    ...collectUnusedDependencies(graph, "devDependencies").map((finding) =>
      toDependencyIssue(
        finding,
        "unused-dev-dependency",
        "Unused dev dependency",
        `"${finding.packageName}" is listed in devDependencies but not used.`,
      ),
    ),
    ...collectUnusedOptionalPeerDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "unused-optional-peer-dependency",
        "Unused optional peer dependency",
        `"${finding.packageName}" is listed as an optional peer but not used.`,
      ),
    ),
    ...collectUnusedPeerDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "unused-peer-dependency",
        "Unused peer dependency",
        `"${finding.packageName}" is listed in peerDependencies but not used.`,
      ),
    ),
    ...collectUnusedOptionalDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "unused-optional-dependency",
        "Unused optional dependency",
        `"${finding.packageName}" is listed in optionalDependencies but not used.`,
      ),
    ),
    ...collectRuntimeDevDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "runtime-dev-dependency",
        "Runtime dependency listed in devDependencies",
        `"${finding.packageName}" is imported by runtime code but listed in devDependencies.`,
      ),
    ),
    ...collectTypeOnlyDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "type-only-dependency",
        "Type-only production dependency",
        `"${finding.packageName}" is only used in type positions.`,
      ),
    ),
    ...collectTestOnlyDependencies(graph).map((finding) =>
      toDependencyIssue(
        finding,
        "test-only-dependency",
        "Test-only production dependency",
        `"${finding.packageName}" is only used from test entrypoints.`,
      ),
    ),
  ]);

export const dependenciesRule = defineRule({
  metadata: {
    id: DEPENDENCIES_RULE_ID,
    name: "Codebase dependencies",
    description:
      "Builds a workspace-aware module graph and reports unresolved, unlisted, unused, type-only, and test-only dependencies.",
    category: "dependencies",
    severity: "warning",
    defaultEnabled: false,
    tags: ["codebase", "dependencies", "oxc"],
  },
  run: async ({ rootDirectory, includePaths, excludePatterns, signal, getCodebaseAnalysis }) => {
    const analysis =
      getCodebaseAnalysis?.() ??
      runCodebaseAnalysis({ rootDirectory, includePaths, excludePatterns, signal });
    return {
      issues: inspectDependencies((await analysis).graph),
    };
  },
});
