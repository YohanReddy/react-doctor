import {
  DEAD_CODE_CHECK_ID,
  EXPECTED_UNUSED_VISIBILITY_TAG,
  INTERNAL_VISIBILITY_TAG,
  PUBLIC_VISIBILITY_TAGS,
} from "./analyzer/constants.js";
import { isVisibilityProtected } from "./analyzer/graph.js";
import { runCodebaseAnalysis } from "./analyzer/index.js";
import type {
  ExportMemberRecord,
  GraphExportSymbol,
  ModuleGraph,
  ModuleGraphNode,
  ProjectFile,
} from "./analyzer/index.js";
import { defineRule } from "../registry.js";
import type { ReactDoctorIssue } from "../../types.js";

export const DEAD_CODE_RULE_ID = DEAD_CODE_CHECK_ID;

interface UnusedFileFinding {
  file: ProjectFile;
}

interface UnusedExportFinding {
  file: ProjectFile;
  exportSymbol: GraphExportSymbol;
}

interface UnusedExportMemberFinding {
  file: ProjectFile;
  exportSymbol: GraphExportSymbol;
  member: ExportMemberRecord;
}

interface DuplicateExportFinding {
  exportName: string;
  exports: Array<{ file: ProjectFile; exportSymbol: GraphExportSymbol }>;
}

const DEFAULT_EXPORT_NAME = "default";
const NAMESPACE_EXPORT_NAME = "*";

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

const isExportUsed = (exportSymbol: GraphExportSymbol): boolean =>
  exportSymbol.references.length > 0 ||
  exportSymbol.hasLocalReferences ||
  exportSymbol.isPluginUsed ||
  isExpectedUnused(exportSymbol) ||
  isVisibilityProtected(exportSymbol);

const hasUsageReference = (exportSymbol: GraphExportSymbol): boolean =>
  exportSymbol.references.length > 0 ||
  exportSymbol.hasLocalReferences ||
  exportSymbol.isPluginUsed;

const isExpectedUnused = (exportSymbol: GraphExportSymbol): boolean =>
  exportSymbol.jsDocTags.has(EXPECTED_UNUSED_VISIBILITY_TAG);

const isMemberVisibilityProtected = (member: ExportMemberRecord): boolean =>
  [...member.jsDocTags].some(
    (tag) => PUBLIC_VISIBILITY_TAGS.has(tag) || tag === INTERNAL_VISIBILITY_TAG,
  );

const isPackageEntrypoint = (entrySources: ReadonlySet<string>): boolean =>
  entrySources.has("package.json");

const isExternalEntrypointExportSurface = (node: ModuleGraphNode): boolean =>
  isPackageEntrypoint(node.entrySources) || node.entryRoles.has("support");

const collectDuplicateExports = (graph: ModuleGraph): DuplicateExportFinding[] => {
  const exportsByName = new Map<string, DuplicateExportFinding["exports"]>();
  for (const node of graph.nodes.values()) {
    if (!node.isReachable) continue;
    if (isExternalEntrypointExportSurface(node)) continue;
    for (const exportSymbol of node.exports.values()) {
      if (
        exportSymbol.exportedName === DEFAULT_EXPORT_NAME ||
        exportSymbol.exportedName === NAMESPACE_EXPORT_NAME
      ) {
        continue;
      }
      const exports = exportsByName.get(exportSymbol.exportedName) ?? [];
      exports.push({ file: node.file, exportSymbol });
      exportsByName.set(exportSymbol.exportedName, exports);
    }
  }
  return [...exportsByName.entries()]
    .filter(([, exports]) => exports.length > 1)
    .map(([exportName, exports]) => ({ exportName, exports }));
};

const collectUnusedFiles = (graph: ModuleGraph): UnusedFileFinding[] =>
  [...graph.nodes.values()]
    .filter((node) => !node.isReachable)
    .map((node) => ({ file: node.file }));

const collectUnusedExports = (graph: ModuleGraph): UnusedExportFinding[] =>
  [...graph.nodes.values()]
    .filter((node) => node.isReachable)
    .flatMap((node) =>
      [...node.exports.values()]
        .filter(
          (exportSymbol) =>
            exportSymbol.exportedName !== NAMESPACE_EXPORT_NAME &&
            !isExportUsed(exportSymbol) &&
            !isExternalEntrypointExportSurface(node),
        )
        .map((exportSymbol) => ({ file: node.file, exportSymbol })),
    );

const collectNamespaceOnlyExports = (graph: ModuleGraph): UnusedExportFinding[] =>
  [...graph.nodes.values()].flatMap((node) =>
    [...node.exports.values()]
      .filter(
        (exportSymbol) =>
          exportSymbol.isReferencedByNamespace &&
          exportSymbol.references.every((reference) => reference.kind === "namespace"),
      )
      .map((exportSymbol) => ({ file: node.file, exportSymbol })),
  );

const isMemberUsed = (exportSymbol: GraphExportSymbol, member: ExportMemberRecord): boolean =>
  member.hasLocalReferences ||
  exportSymbol.referencedMemberNames.has(member.name) ||
  member.jsDocTags.has(EXPECTED_UNUSED_VISIBILITY_TAG) ||
  isMemberVisibilityProtected(member);

const collectUnusedExportMembers = (graph: ModuleGraph): UnusedExportMemberFinding[] =>
  [...graph.nodes.values()]
    .filter((node) => node.isReachable && !isExternalEntrypointExportSurface(node))
    .flatMap((node) =>
      [...node.exports.values()]
        .filter((exportSymbol) => isExportUsed(exportSymbol))
        .flatMap((exportSymbol) =>
          exportSymbol.members
            .filter((member) => !isMemberUsed(exportSymbol, member))
            .map((member) => ({ file: node.file, exportSymbol, member })),
        ),
    );

const collectStaleExpectedUnusedExports = (graph: ModuleGraph): UnusedExportFinding[] =>
  [...graph.nodes.values()].flatMap((node) =>
    [...node.exports.values()]
      .filter(
        (exportSymbol) =>
          exportSymbol.exportedName !== NAMESPACE_EXPORT_NAME &&
          isExpectedUnused(exportSymbol) &&
          hasUsageReference(exportSymbol),
      )
      .map((exportSymbol) => ({ file: node.file, exportSymbol })),
  );

const toUnusedFileIssue = (finding: UnusedFileFinding): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEAD_CODE_CHECK_ID}/unused-file/${finding.file.relativePath}`,
    title: "Unused file",
    message:
      "This source file is not reachable from any package, framework, test, or support entrypoint.",
    location: { filePath: finding.file.relativePath },
    recommendation: "Remove the file or connect it to a real entrypoint.",
    source: { checkId: DEAD_CODE_CHECK_ID, ruleId: "unused-file" },
  });

const toUnusedExportIssue = (
  finding: UnusedExportFinding,
  ruleId: string,
  title: string,
): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEAD_CODE_CHECK_ID}/${ruleId}/${finding.file.relativePath}/${finding.exportSymbol.exportedName}`,
    title,
    message: `The exported symbol "${finding.exportSymbol.exportedName}" is not referenced by reachable modules.`,
    location: {
      filePath: finding.file.relativePath,
      line: finding.exportSymbol.position.line,
      column: finding.exportSymbol.position.column,
    },
    recommendation: "Remove the export or make it part of an entrypoint API.",
    source: { checkId: DEAD_CODE_CHECK_ID, ruleId },
  });

const toDuplicateExportIssue = (finding: DuplicateExportFinding): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEAD_CODE_CHECK_ID}/duplicate-export/${finding.exportName}`,
    title: "Duplicate export",
    message: `The exported symbol "${finding.exportName}" appears in ${finding.exports.length} files.`,
    location: { filePath: finding.exports[0]?.file.relativePath ?? "" },
    recommendation: "Consolidate the public API or use more specific names.",
    source: { checkId: DEAD_CODE_CHECK_ID, ruleId: "duplicate-export" },
  });

const toUnusedExportMemberIssue = (finding: UnusedExportMemberFinding): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEAD_CODE_CHECK_ID}/unused-${finding.member.kind}-member/${finding.file.relativePath}/${finding.exportSymbol.exportedName}.${finding.member.name}`,
    title: `Unused ${finding.member.kind} member`,
    message: `The exported ${finding.member.kind} member "${finding.exportSymbol.exportedName}.${finding.member.name}" is not referenced by reachable modules.`,
    location: {
      filePath: finding.file.relativePath,
      line: finding.member.position.line,
      column: finding.member.position.column,
    },
    recommendation: "Remove the member or reference it from reachable code.",
    source: { checkId: DEAD_CODE_CHECK_ID, ruleId: `unused-${finding.member.kind}-member` },
  });

const toStaleExpectedUnusedIssue = (finding: UnusedExportFinding): ReactDoctorIssue =>
  createCodebaseIssue({
    id: `${DEAD_CODE_CHECK_ID}/stale-expected-unused/${finding.file.relativePath}/${finding.exportSymbol.exportedName}`,
    title: "Stale expected-unused marker",
    message: `The exported symbol "${finding.exportSymbol.exportedName}" is marked @expected-unused but is now referenced.`,
    location: {
      filePath: finding.file.relativePath,
      line: finding.exportSymbol.position.line,
      column: finding.exportSymbol.position.column,
    },
    recommendation: "Remove the @expected-unused marker or stop referencing the export.",
    source: { checkId: DEAD_CODE_CHECK_ID, ruleId: "stale-expected-unused" },
  });

const inspectDeadCode = (graph: ModuleGraph): ReactDoctorIssue[] => {
  const unusedExports = collectUnusedExports(graph);
  return sortIssues([
    ...collectUnusedFiles(graph).map(toUnusedFileIssue),
    ...unusedExports
      .filter((finding) => !finding.exportSymbol.isTypeOnly)
      .map((finding) => toUnusedExportIssue(finding, "unused-export", "Unused export")),
    ...unusedExports
      .filter((finding) => finding.exportSymbol.isTypeOnly)
      .map((finding) => toUnusedExportIssue(finding, "unused-type-export", "Unused type export")),
    ...collectNamespaceOnlyExports(graph).map((finding) =>
      toUnusedExportIssue(finding, "namespace-only-export", "Namespace-only export"),
    ),
    ...collectUnusedExportMembers(graph).map(toUnusedExportMemberIssue),
    ...collectStaleExpectedUnusedExports(graph).map(toStaleExpectedUnusedIssue),
    ...collectDuplicateExports(graph).map(toDuplicateExportIssue),
  ]);
};

export const deadCodeRule = defineRule({
  metadata: {
    id: DEAD_CODE_RULE_ID,
    name: "Codebase dead code",
    description:
      "Builds a project module graph and reports unused files, exports, types, and duplicate exports.",
    category: "dead-code",
    severity: "warning",
    defaultEnabled: false,
    tags: ["codebase", "dead-code", "oxc"],
  },
  run: async ({ rootDirectory, includePaths, excludePatterns, signal, getCodebaseAnalysis }) => {
    const analysis =
      getCodebaseAnalysis?.() ??
      runCodebaseAnalysis({ rootDirectory, includePaths, excludePatterns, signal });
    return {
      issues: inspectDeadCode((await analysis).graph),
    };
  },
});
