import {
  INTERNAL_VISIBILITY_TAG,
  PACKAGE_JSON_FILENAME,
  PUBLIC_VISIBILITY_TAGS,
} from "./constants.js";
import { matchesAnyGlob, toRelativePath } from "./path-utils.js";
import type { CodebasePluginResult } from "./plugins/types.js";
import type {
  CodebaseAnalysisConfig,
  EntryPoint,
  EntryPointRole,
  GraphExportSymbol,
  ModuleGraph,
  ModuleGraphNode,
  ResolvedImport,
  ResolvedModule,
  WorkspaceInfo,
} from "./types.js";

interface ReachabilityWorkItem {
  fileId: number;
  role: EntryPointRole | "type";
}

const createGraphNode = (
  resolvedModule: ResolvedModule,
  entryPoints: EntryPoint[],
): ModuleGraphNode => ({
  file: resolvedModule.module.file,
  imports: resolvedModule.imports,
  importedBy: new Set(),
  exports: new Map(
    resolvedModule.module.exports.map((exportRecord) => [
      exportRecord.exportedName,
      {
        ...exportRecord,
        references: [],
        isPluginUsed: false,
        isReferencedByNamespace: false,
        referencedMemberNames: new Set(),
      },
    ]),
  ),
  directives: resolvedModule.module.directives,
  parseErrors: resolvedModule.module.parseErrors,
  usedIdentifiers: resolvedModule.module.usedIdentifiers,
  namespaceMemberReferences: resolvedModule.module.namespaceMemberReferences,
  namespaceObjectAliases: resolvedModule.module.namespaceObjectAliases,
  namespaceLocalAliases: resolvedModule.module.namespaceLocalAliases,
  namespaceLocalObjectAliases: resolvedModule.module.namespaceLocalObjectAliases,
  entryRoles: new Set(
    entryPoints
      .filter((entryPoint) => entryPoint.fileId === resolvedModule.module.file.id)
      .map((entryPoint) => entryPoint.role),
  ),
  entrySources: new Set(
    entryPoints
      .filter((entryPoint) => entryPoint.fileId === resolvedModule.module.file.id)
      .map((entryPoint) => entryPoint.source),
  ),
  isReachable: false,
  isRuntimeReachable: false,
  isTestReachable: false,
  isTypeReachable: false,
  hasCjsExports: resolvedModule.module.cjsExportNames.size > 0,
});

const createPathToNodeMap = (nodes: Map<number, ModuleGraphNode>): Map<string, ModuleGraphNode> =>
  new Map([...nodes.values()].map((node) => [node.file.filePath, node]));

const connectReverseImports = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  for (const node of nodes.values()) {
    for (const resolvedImport of node.imports) {
      if (resolvedImport.targetKind !== "internal" || !resolvedImport.targetFilePath) continue;
      const targetNode = pathToNode.get(resolvedImport.targetFilePath);
      targetNode?.importedBy.add(node.file.id);
    }
  }
};

const markReachableFiles = (
  nodes: Map<number, ModuleGraphNode>,
  entryPoints: EntryPoint[],
): void => {
  const pending: ReachabilityWorkItem[] = entryPoints.map((entryPoint) => ({
    fileId: entryPoint.fileId,
    role: entryPoint.role,
  }));
  const visitedKeys = new Set<string>();
  const pathToNode = createPathToNodeMap(nodes);

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    const key = `${item.fileId}:${item.role}`;
    if (visitedKeys.has(key)) continue;
    visitedKeys.add(key);
    const node = nodes.get(item.fileId);
    if (!node) continue;
    node.isReachable = true;
    if (item.role === "runtime") node.isRuntimeReachable = true;
    if (item.role === "test") node.isTestReachable = true;
    if (item.role === "type") node.isTypeReachable = true;
    for (const resolvedImport of node.imports) {
      if (resolvedImport.targetKind === "internal" && resolvedImport.targetFilePath) {
        const targetNode = pathToNode.get(resolvedImport.targetFilePath);
        const role = resolvedImport.importRecord.isTypeOnly ? "type" : item.role;
        if (targetNode) pending.push({ fileId: targetNode.file.id, role });
      }
    }
  }
};

const findExportSymbol = (
  node: ModuleGraphNode,
  importedName: string,
): GraphExportSymbol | undefined =>
  node.exports.get(importedName) ??
  (importedName === "default" ? node.exports.get("default") : undefined);

const addExportReference = (
  exportSymbol: GraphExportSymbol,
  reference: GraphExportSymbol["references"][number],
): boolean => {
  if (
    exportSymbol.references.some(
      (existingReference) =>
        existingReference.fromFileId === reference.fromFileId &&
        existingReference.importRecord.source === reference.importRecord.source &&
        existingReference.kind === reference.kind,
    )
  ) {
    return false;
  }
  exportSymbol.references.push(reference);
  return true;
};

const addExportMemberReferences = (
  exportSymbol: GraphExportSymbol,
  memberNames: Iterable<string>,
): void => {
  for (const memberName of memberNames) {
    if (exportSymbol.members.some((member) => member.name === memberName)) {
      exportSymbol.referencedMemberNames.add(memberName);
    }
  }
};

const getMemberReferencesForLocalName = (node: ModuleGraphNode, localName: string): string[] =>
  node.namespaceMemberReferences
    .filter((reference) => reference.namespace === localName && reference.memberPath.length >= 1)
    .map((reference) => reference.memberPath[0])
    .filter((memberName): memberName is string => Boolean(memberName));

const getNamespaceMemberReferencesForLocalName = (node: ModuleGraphNode, localName: string) => [
  ...node.namespaceMemberReferences.filter((reference) => reference.namespace === localName),
  ...node.namespaceLocalAliases
    .filter(
      (alias) =>
        alias.namespaceLocalName === localName && node.usedIdentifiers.has(alias.aliasName),
    )
    .flatMap((alias) =>
      node.namespaceMemberReferences.filter((reference) => reference.namespace === alias.aliasName),
    ),
];

const addImportReferences = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  for (const node of nodes.values()) {
    for (const resolvedImport of node.imports) {
      if (resolvedImport.targetKind !== "internal" || !resolvedImport.targetFilePath) continue;
      const targetNode = pathToNode.get(resolvedImport.targetFilePath);
      if (!targetNode) continue;
      if (resolvedImport.importRecord.bindings.length === 0) {
        continue;
      }
      for (const binding of resolvedImport.importRecord.bindings) {
        if (resolvedImport.importRecord.kind === "re-export" && binding.isNamespace) {
          continue;
        }
        const isReExport = resolvedImport.importRecord.kind === "re-export";
        if (!isReExport && !node.usedIdentifiers.has(binding.localName)) {
          continue;
        }
        if (binding.isNamespace) {
          const namespaceReferences = getNamespaceMemberReferencesForLocalName(
            node,
            binding.localName,
          );
          const referencedMemberNames = new Set(
            namespaceReferences
              .map((reference) => reference.memberPath[0])
              .filter((memberName): memberName is string => Boolean(memberName)),
          );
          if (
            referencedMemberNames.size === 0 &&
            (node.namespaceObjectAliases.some(
              (alias) => alias.namespaceLocalName === binding.localName,
            ) ||
              node.namespaceLocalAliases.some(
                (alias) => alias.namespaceLocalName === binding.localName,
              ) ||
              node.namespaceLocalObjectAliases.some(
                (alias) => alias.namespaceLocalName === binding.localName,
              ))
          ) {
            continue;
          }
          const referencedExportSymbols =
            referencedMemberNames.size > 0
              ? [...referencedMemberNames].flatMap((memberName) => {
                  const exportSymbol = targetNode.exports.get(memberName);
                  return exportSymbol ? [exportSymbol] : [];
                })
              : [...targetNode.exports.values()];
          for (const exportSymbol of referencedExportSymbols) {
            exportSymbol.isReferencedByNamespace = true;
            addExportMemberReferences(
              exportSymbol,
              namespaceReferences
                .filter((reference) => reference.memberPath[0] === exportSymbol.exportedName)
                .map((reference) => reference.memberPath[1])
                .filter((memberName): memberName is string => Boolean(memberName)),
            );
            addExportReference(exportSymbol, {
              fromFileId: node.file.id,
              kind: referencedMemberNames.size > 0 ? "namespace-member" : "namespace",
              importRecord: resolvedImport.importRecord,
            });
          }
          continue;
        }
        const exportSymbol = findExportSymbol(targetNode, binding.importedName);
        if (exportSymbol && node.file.id !== targetNode.file.id) {
          addExportMemberReferences(
            exportSymbol,
            getMemberReferencesForLocalName(node, binding.localName),
          );
          addExportReference(exportSymbol, {
            fromFileId: node.file.id,
            kind: binding.importedName === "default" ? "default" : "named",
            importRecord: resolvedImport.importRecord,
          });
        }
      }
    }
  }
};

const addLocalExportMemberReferences = (nodes: Map<number, ModuleGraphNode>): void => {
  for (const node of nodes.values()) {
    for (const exportSymbol of node.exports.values()) {
      const localName = exportSymbol.localName ?? exportSymbol.exportedName;
      addExportMemberReferences(exportSymbol, getMemberReferencesForLocalName(node, localName));
    }
  }
};

const propagateNamespaceLocalObjectAliases = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  for (const node of nodes.values()) {
    if (node.namespaceLocalObjectAliases.length === 0) continue;
    for (const memberReference of node.namespaceMemberReferences.filter(
      (reference) => !isPrefixMemberReference(reference, node.namespaceMemberReferences),
    )) {
      const alias = node.namespaceLocalObjectAliases.find(
        (item) =>
          item.objectLocalName === memberReference.namespace &&
          item.propertyName === memberReference.memberPath[0],
      );
      if (!alias) continue;
      const namespaceTargetNode = findNamespaceImportTarget(
        node,
        pathToNode,
        alias.namespaceLocalName,
      );
      if (!namespaceTargetNode) continue;
      const targetMemberPath = memberReference.memberPath.slice(1);
      if (targetMemberPath.length === 0) {
        const importRecord = findNamespaceImportRecord(node, alias.namespaceLocalName);
        if (importRecord)
          addNamespaceObjectReference(namespaceTargetNode, node.file.id, importRecord);
        continue;
      }
      const importRecord = findNamespaceImportRecord(node, alias.namespaceLocalName);
      if (importRecord) {
        addNamespaceMemberPathReference(
          namespaceTargetNode,
          targetMemberPath,
          node.file.id,
          importRecord,
        );
      }
    }
  }
};

const findNamespaceImportTarget = (
  node: ModuleGraphNode,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
  namespaceLocalName: string,
): ModuleGraphNode | null => {
  for (const resolvedImport of node.imports) {
    if (resolvedImport.targetKind !== "internal" || !resolvedImport.targetFilePath) continue;
    if (
      resolvedImport.importRecord.bindings.some(
        (binding) => binding.isNamespace && binding.localName === namespaceLocalName,
      )
    ) {
      return pathToNode.get(resolvedImport.targetFilePath) ?? null;
    }
  }
  return null;
};

const findNamespaceImportRecord = (
  node: ModuleGraphNode,
  namespaceLocalName: string,
): ResolvedImport["importRecord"] | null => {
  const resolvedImport = node.imports.find((item) =>
    item.importRecord.bindings.some(
      (binding) => binding.isNamespace && binding.localName === namespaceLocalName,
    ),
  );
  return resolvedImport?.importRecord ?? null;
};

const addNamespaceMemberReference = (
  targetNode: ModuleGraphNode,
  exportName: string,
  fromFileId: number,
  importRecord: ResolvedImport["importRecord"],
  exportedMemberNames: Iterable<string> = [],
): void => {
  const exportSymbol = targetNode.exports.get(exportName);
  if (!exportSymbol) return;
  exportSymbol.isReferencedByNamespace = true;
  addExportMemberReferences(exportSymbol, exportedMemberNames);
  addExportReference(exportSymbol, {
    fromFileId,
    kind: "namespace-member",
    importRecord,
  });
};

const addNamespaceMemberPathReference = (
  targetNode: ModuleGraphNode,
  memberPath: string[],
  fromFileId: number,
  importRecord: ResolvedImport["importRecord"],
): void => {
  const exportName = memberPath[0];
  if (!exportName) return;
  addNamespaceMemberReference(
    targetNode,
    exportName,
    fromFileId,
    importRecord,
    memberPath.slice(1),
  );
};

const addNamespaceObjectReference = (
  targetNode: ModuleGraphNode,
  fromFileId: number,
  importRecord: ResolvedImport["importRecord"],
): void => {
  for (const exportSymbol of targetNode.exports.values()) {
    exportSymbol.isReferencedByNamespace = true;
    addExportReference(exportSymbol, {
      fromFileId,
      kind: "namespace",
      importRecord,
    });
  }
};

const isPrefixMemberReference = (
  reference: ModuleGraphNode["namespaceMemberReferences"][number],
  references: ModuleGraphNode["namespaceMemberReferences"],
): boolean =>
  references.some(
    (candidate) =>
      candidate !== reference &&
      candidate.namespace === reference.namespace &&
      candidate.memberPath.length > reference.memberPath.length &&
      reference.memberPath.every((memberName, index) => candidate.memberPath[index] === memberName),
  );

const propagateNamespaceObjectAliases = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  for (const consumerNode of nodes.values()) {
    for (const resolvedImport of consumerNode.imports) {
      if (resolvedImport.targetKind !== "internal" || !resolvedImport.targetFilePath) continue;
      const aliasNode = pathToNode.get(resolvedImport.targetFilePath);
      if (!aliasNode || aliasNode.namespaceObjectAliases.length === 0) continue;
      for (const binding of resolvedImport.importRecord.bindings) {
        if (!consumerNode.usedIdentifiers.has(binding.localName)) continue;
        const bindingMemberReferences = consumerNode.namespaceMemberReferences.filter(
          (reference) => reference.namespace === binding.localName,
        );
        if (bindingMemberReferences.length === 0) {
          const aliases = aliasNode.namespaceObjectAliases.filter(
            (alias) => binding.isNamespace || alias.exportName === binding.importedName,
          );
          for (const alias of aliases) {
            const namespaceTargetNode = findNamespaceImportTarget(
              aliasNode,
              pathToNode,
              alias.namespaceLocalName,
            );
            if (namespaceTargetNode) {
              addNamespaceObjectReference(
                namespaceTargetNode,
                consumerNode.file.id,
                resolvedImport.importRecord,
              );
            }
          }
          continue;
        }
        for (const memberReference of bindingMemberReferences.filter(
          (reference) => !isPrefixMemberReference(reference, bindingMemberReferences),
        )) {
          const exportNameOffset = binding.isNamespace ? 1 : 0;
          const alias = aliasNode.namespaceObjectAliases.find(
            (item) =>
              item.exportName ===
                (binding.isNamespace ? memberReference.memberPath[0] : binding.importedName) &&
              item.propertyName === memberReference.memberPath[exportNameOffset],
          );
          if (!alias) continue;
          const namespaceTargetNode = findNamespaceImportTarget(
            aliasNode,
            pathToNode,
            alias.namespaceLocalName,
          );
          if (!namespaceTargetNode) continue;
          const targetMemberPath = memberReference.memberPath.slice(exportNameOffset + 1);
          if (targetMemberPath.length === 0) {
            addNamespaceObjectReference(
              namespaceTargetNode,
              consumerNode.file.id,
              resolvedImport.importRecord,
            );
            continue;
          }
          addNamespaceMemberPathReference(
            namespaceTargetNode,
            targetMemberPath,
            consumerNode.file.id,
            resolvedImport.importRecord,
          );
        }
      }
    }
  }
};

interface NamespaceReExportReference {
  kind: "member" | "namespace";
  memberPath?: string[];
  importRecord: ResolvedImport["importRecord"];
}

const collectNamespaceReExportReferences = (
  consumerNode: ModuleGraphNode,
  targetNode: ModuleGraphNode,
  exportName: string,
): NamespaceReExportReference[] => {
  const references: NamespaceReExportReference[] = [];
  for (const resolvedImport of consumerNode.imports) {
    if (
      resolvedImport.targetKind !== "internal" ||
      resolvedImport.targetFilePath !== targetNode.file.filePath
    ) {
      continue;
    }
    for (const binding of resolvedImport.importRecord.bindings) {
      if (!consumerNode.usedIdentifiers.has(binding.localName)) continue;
      if (binding.isNamespace) {
        const bindingReferences = consumerNode.namespaceMemberReferences.filter(
          (item) => item.namespace === binding.localName,
        );
        const exportReferences = bindingReferences.filter(
          (item) => item.memberPath[0] === exportName,
        );
        const standaloneExportReferences = exportReferences.filter(
          (item) => !isPrefixMemberReference(item, bindingReferences),
        );
        if (
          bindingReferences.length === 0 ||
          standaloneExportReferences.some((item) => item.memberPath.length === 1)
        ) {
          references.push({ kind: "namespace", importRecord: resolvedImport.importRecord });
          continue;
        }
        for (const reference of standaloneExportReferences.filter(
          (item) => item.memberPath.length >= 2,
        )) {
          references.push({
            kind: "member",
            memberPath: reference.memberPath.slice(1),
            importRecord: resolvedImport.importRecord,
          });
        }
        continue;
      }
      if (binding.importedName !== exportName) continue;
      const bindingReferences = consumerNode.namespaceMemberReferences.filter(
        (item) => item.namespace === binding.localName,
      );
      if (bindingReferences.length === 0) {
        references.push({ kind: "namespace", importRecord: resolvedImport.importRecord });
        continue;
      }
      for (const reference of bindingReferences.filter(
        (item) => !isPrefixMemberReference(item, bindingReferences),
      )) {
        references.push({
          kind: "member",
          memberPath: reference.memberPath,
          importRecord: resolvedImport.importRecord,
        });
      }
    }
  }
  return references;
};

interface ReachableNamespaceReExport {
  node: ModuleGraphNode;
  exportName: string;
}

const enumerateReachableNamespaceReExports = (
  nodes: Map<number, ModuleGraphNode>,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
  seedNode: ModuleGraphNode,
  seedExportName: string,
): ReachableNamespaceReExport[] => {
  const reachableByKey = new Map<string, ReachableNamespaceReExport>();
  const pending: ReachableNamespaceReExport[] = [{ node: seedNode, exportName: seedExportName }];
  for (const item of pending) {
    const key = `${item.node.file.id}:${item.exportName}`;
    if (reachableByKey.has(key)) continue;
    reachableByKey.set(key, item);
    for (const candidateNode of nodes.values()) {
      for (const candidateExport of candidateNode.exports.values()) {
        if (!candidateExport.isReExport || !candidateExport.source) continue;
        const candidateSourceNode = getInternalImportTarget(
          candidateNode,
          pathToNode,
          candidateExport.source,
        );
        if (candidateSourceNode?.file.id !== item.node.file.id) continue;
        if (candidateExport.isNamespace && candidateExport.exportedName !== "*") continue;
        if (candidateExport.importedName === item.exportName) {
          pending.push({ node: candidateNode, exportName: candidateExport.exportedName });
        } else if (candidateExport.importedName === "*" && candidateExport.exportedName === "*") {
          pending.push({ node: candidateNode, exportName: item.exportName });
        }
      }
    }
  }
  return [...reachableByKey.values()];
};

const propagateNamespaceReExportReferences = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  for (const node of nodes.values()) {
    for (const exportSymbol of node.exports.values()) {
      if (
        !exportSymbol.isReExport ||
        !exportSymbol.isNamespace ||
        !exportSymbol.source ||
        exportSymbol.exportedName === "*"
      ) {
        continue;
      }
      const sourceNode = getInternalImportTarget(node, pathToNode, exportSymbol.source);
      if (!sourceNode) continue;
      const reachableExports = enumerateReachableNamespaceReExports(
        nodes,
        pathToNode,
        node,
        exportSymbol.exportedName,
      );
      if (reachableExports.some((item) => isPackageEntrypoint(item.node))) {
        for (const sourceExport of sourceNode.exports.values()) {
          if (sourceExport.exportedName === "default" || sourceExport.exportedName === "*")
            continue;
          addExportReference(sourceExport, {
            fromFileId: node.file.id,
            kind: "re-export",
            importRecord: getInternalImportRecord(node, exportSymbol.source) ??
              node.imports[0]?.importRecord ?? {
                source: exportSymbol.source,
                bindings: [],
                kind: "re-export",
                isTypeOnly: exportSymbol.isTypeOnly,
                isSideEffectOnly: false,
                isOptional: false,
                start: exportSymbol.start,
                end: exportSymbol.end,
                position: exportSymbol.position,
              },
          });
        }
        continue;
      }
      for (const reachableExport of reachableExports) {
        for (const consumerNode of nodes.values()) {
          for (const reference of collectNamespaceReExportReferences(
            consumerNode,
            reachableExport.node,
            reachableExport.exportName,
          )) {
            if (reference.kind === "namespace") {
              addNamespaceObjectReference(sourceNode, consumerNode.file.id, reference.importRecord);
              continue;
            }
            if (reference.memberPath) {
              addNamespaceMemberPathReference(
                sourceNode,
                reference.memberPath,
                consumerNode.file.id,
                reference.importRecord,
              );
            }
          }
        }
      }
    }
  }
};

const isPackageEntrypoint = (node: ModuleGraphNode): boolean =>
  node.entrySources.has("package.json");

const getInternalImportTarget = (
  node: ModuleGraphNode,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
  source: string,
): ModuleGraphNode | null => {
  const sourceImport = node.imports.find(
    (resolvedImport) => resolvedImport.importRecord.source === source,
  );
  if (sourceImport?.targetKind !== "internal" || !sourceImport.targetFilePath) return null;
  return pathToNode.get(sourceImport.targetFilePath) ?? null;
};

const getInternalImportRecord = (
  node: ModuleGraphNode,
  source: string,
): ResolvedImport["importRecord"] | null =>
  node.imports.find((resolvedImport) => resolvedImport.importRecord.source === source)
    ?.importRecord ?? null;

const propagateStarReferenceToSource = (
  sourceNode: ModuleGraphNode,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
  exportName: string,
  reference: GraphExportSymbol["references"][number],
  visitedNodeIds = new Set<number>(),
): boolean => {
  if (visitedNodeIds.has(sourceNode.file.id)) return false;
  visitedNodeIds.add(sourceNode.file.id);
  const sourceExport = sourceNode.exports.get(exportName);
  if (sourceExport) return addExportReference(sourceExport, { ...reference, kind: "re-export" });
  let didChange = false;
  for (const starExport of sourceNode.exports.values()) {
    if (!starExport.isReExport || !starExport.source || starExport.exportedName !== "*") continue;
    const nextSourceNode = getInternalImportTarget(sourceNode, pathToNode, starExport.source);
    if (!nextSourceNode) continue;
    didChange =
      propagateStarReferenceToSource(
        nextSourceNode,
        pathToNode,
        exportName,
        reference,
        visitedNodeIds,
      ) || didChange;
  }
  return didChange;
};

const collectNamedImportReferencesToNode = (
  nodes: ReadonlyMap<number, ModuleGraphNode>,
  targetNode: ModuleGraphNode,
): Map<string, GraphExportSymbol["references"]> => {
  const referencesByName = new Map<string, GraphExportSymbol["references"]>();
  for (const importerNode of nodes.values()) {
    for (const resolvedImport of importerNode.imports) {
      if (
        resolvedImport.targetKind !== "internal" ||
        resolvedImport.targetFilePath !== targetNode.file.filePath
      ) {
        continue;
      }
      for (const binding of resolvedImport.importRecord.bindings) {
        if (
          binding.isNamespace ||
          binding.importedName === "default" ||
          binding.importedName === "*"
        ) {
          continue;
        }
        const references = referencesByName.get(binding.importedName) ?? [];
        references.push({
          fromFileId: importerNode.file.id,
          kind: "re-export",
          importRecord: resolvedImport.importRecord,
        });
        referencesByName.set(binding.importedName, references);
      }
    }
  }
  return referencesByName;
};

const collectReferencedExports = (
  node: ModuleGraphNode,
): Map<string, GraphExportSymbol["references"]> => {
  const referencesByName = new Map<string, GraphExportSymbol["references"]>();
  for (const exportSymbol of node.exports.values()) {
    if (exportSymbol.references.length === 0) continue;
    referencesByName.set(exportSymbol.exportedName, [...exportSymbol.references]);
  }
  return referencesByName;
};

const propagateStarReExportReferences = (
  nodes: ReadonlyMap<number, ModuleGraphNode>,
  node: ModuleGraphNode,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
): boolean => {
  let didChange = false;
  const namedImportReferences = collectNamedImportReferencesToNode(nodes, node);
  const referencedExports = collectReferencedExports(node);
  for (const exportSymbol of node.exports.values()) {
    if (!exportSymbol.isReExport || !exportSymbol.source || exportSymbol.exportedName !== "*") {
      continue;
    }
    const sourceNode = getInternalImportTarget(node, pathToNode, exportSymbol.source);
    if (!sourceNode) continue;
    const importRecord = getInternalImportRecord(node, exportSymbol.source);
    if (!importRecord) continue;
    if (isPackageEntrypoint(node)) {
      for (const sourceExport of sourceNode.exports.values()) {
        if (sourceExport.exportedName === "default" || sourceExport.exportedName === "*") continue;
        didChange =
          addExportReference(sourceExport, {
            fromFileId: node.file.id,
            kind: "re-export",
            importRecord,
          }) || didChange;
      }
      continue;
    }
    for (const [exportName, references] of [...namedImportReferences, ...referencedExports]) {
      if (exportName === "default" || exportName === "*") continue;
      for (const reference of references) {
        didChange =
          propagateStarReferenceToSource(sourceNode, pathToNode, exportName, reference) ||
          didChange;
      }
    }
  }
  return didChange;
};

const propagateNamedReExportReferences = (
  node: ModuleGraphNode,
  pathToNode: ReadonlyMap<string, ModuleGraphNode>,
  exportSymbol: GraphExportSymbol,
): boolean => {
  if (!exportSymbol.isReExport || !exportSymbol.source || exportSymbol.exportedName === "*") {
    return false;
  }
  const sourceNode = getInternalImportTarget(node, pathToNode, exportSymbol.source);
  if (!sourceNode) return false;
  const importRecord = getInternalImportRecord(node, exportSymbol.source);
  if (!importRecord) return false;
  const targetExportName = exportSymbol.importedName ?? exportSymbol.exportedName;
  const targetExport = sourceNode.exports.get(targetExportName);
  if (!targetExport) return false;
  const references =
    exportSymbol.references.length > 0
      ? exportSymbol.references
      : isPackageEntrypoint(node)
        ? [
            {
              fromFileId: node.file.id,
              kind: "re-export" as const,
              importRecord,
            },
          ]
        : [];
  let didChange = false;
  for (const reference of references) {
    didChange = addExportReference(targetExport, { ...reference, kind: "re-export" }) || didChange;
  }
  return didChange;
};

const propagateReExportReferences = (nodes: Map<number, ModuleGraphNode>): void => {
  const pathToNode = createPathToNodeMap(nodes);
  let didChange = true;
  while (didChange) {
    didChange = false;
    for (const node of nodes.values()) {
      didChange = propagateStarReExportReferences(nodes, node, pathToNode) || didChange;
      for (const exportSymbol of node.exports.values()) {
        didChange = propagateNamedReExportReferences(node, pathToNode, exportSymbol) || didChange;
      }
    }
  }
};

const applyPluginUsedExports = (
  nodes: Map<number, ModuleGraphNode>,
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
  workspaces: WorkspaceInfo[],
): void => {
  for (const node of nodes.values()) {
    const workspace = workspaces[node.file.workspaceId];
    const pluginResult = pluginResults.get(node.file.workspaceId);
    if (!workspace || !pluginResult) continue;
    const workspaceRelativePath = toRelativePath(workspace.directory, node.file.filePath);
    for (const [pattern, exportNames] of pluginResult.usedExports) {
      if (!matchesAnyGlob(workspaceRelativePath, [pattern])) continue;
      for (const exportName of exportNames) {
        const exportSymbol = node.exports.get(exportName);
        if (exportSymbol) exportSymbol.isPluginUsed = true;
      }
    }
  }
};

const collectUnresolvedImports = (nodes: Map<number, ModuleGraphNode>): ResolvedImport[] => {
  const unresolvedImports: ResolvedImport[] = [];
  for (const node of nodes.values()) {
    unresolvedImports.push(
      ...node.imports.filter((resolvedImport) => resolvedImport.targetKind === "unresolved"),
    );
  }
  return unresolvedImports;
};

const isLoaderPackageUsage = (resolvedImport: ResolvedImport): boolean =>
  resolvedImport.importRecord.source.includes("!") &&
  Boolean(
    resolvedImport.packageName &&
    resolvedImport.importRecord.source
      .split("!")
      .slice(0, -1)
      .some((loader) => loader.includes(resolvedImport.packageName ?? "")),
  );

const collectPackageUsages = (nodes: Map<number, ModuleGraphNode>, workspaces: WorkspaceInfo[]) => {
  const workspaceNames = new Set(workspaces.map((workspace) => workspace.name));
  const pathToNode = createPathToNodeMap(nodes);
  return [...nodes.values()].flatMap((node) =>
    node.imports
      .filter((resolvedImport) => {
        if (!resolvedImport.packageName) return false;
        if (
          resolvedImport.targetKind === "external" ||
          resolvedImport.targetKind === "unresolved"
        ) {
          return true;
        }
        if (!workspaceNames.has(resolvedImport.packageName)) return false;
        if (resolvedImport.targetKind !== "internal" || !resolvedImport.targetFilePath) {
          return false;
        }
        const targetNode = pathToNode.get(resolvedImport.targetFilePath);
        return Boolean(targetNode && targetNode.file.workspaceId !== node.file.workspaceId);
      })
      .map((resolvedImport) => ({
        packageName: resolvedImport.packageName ?? "",
        workspaceId: node.file.workspaceId,
        fromFileId: node.file.id,
        specifier: resolvedImport.importRecord.source,
        isTypeOnly: resolvedImport.importRecord.isTypeOnly,
        isRuntime: node.isRuntimeReachable && !isLoaderPackageUsage(resolvedImport),
        isTestOnly: node.isTestReachable && !node.isRuntimeReachable,
      })),
  );
};

export const buildModuleGraph = (
  config: CodebaseAnalysisConfig,
  workspaces: WorkspaceInfo[],
  resolvedModules: ResolvedModule[],
  entryPoints: EntryPoint[],
  pluginResults: ReadonlyMap<number, CodebasePluginResult>,
): ModuleGraph => {
  const nodes = new Map<number, ModuleGraphNode>();

  for (const resolvedModule of resolvedModules) {
    nodes.set(resolvedModule.module.file.id, createGraphNode(resolvedModule, entryPoints));
  }

  connectReverseImports(nodes);
  markReachableFiles(nodes, entryPoints);
  addImportReferences(nodes);
  addLocalExportMemberReferences(nodes);
  propagateNamespaceLocalObjectAliases(nodes);
  propagateNamespaceObjectAliases(nodes);
  propagateNamespaceReExportReferences(nodes);
  propagateReExportReferences(nodes);
  applyPluginUsedExports(nodes, pluginResults, workspaces);

  return {
    rootDirectory: config.rootDirectory,
    config,
    workspaces,
    files: resolvedModules.map((resolvedModule) => resolvedModule.module.file),
    nodes,
    pathToFileId: new Map(
      resolvedModules.map((resolvedModule) => [
        resolvedModule.module.file.filePath,
        resolvedModule.module.file.id,
      ]),
    ),
    entryPoints,
    packageUsages: collectPackageUsages(nodes, workspaces),
    unresolvedImports: collectUnresolvedImports(nodes),
    pluginResults,
  };
};

export const getPackageJsonPath = (rootDirectory: string): string =>
  `${rootDirectory}/${PACKAGE_JSON_FILENAME}`;

export const isVisibilityProtected = (exportSymbol: GraphExportSymbol): boolean =>
  [...exportSymbol.jsDocTags].some(
    (tag) => PUBLIC_VISIBILITY_TAGS.has(tag) || tag === INTERNAL_VISIBILITY_TAG,
  );
