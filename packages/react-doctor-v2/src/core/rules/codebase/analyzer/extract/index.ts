import { parseSync } from "oxc-parser";
import type { StaticExportEntry, StaticImport, StaticImportEntry } from "oxc-parser";
import {
  CHILD_PROCESS_ENTRY_METHODS,
  CHILD_PROCESS_MODULE_SPECIFIERS,
  NODE_MODULE_SPECIFIERS,
  PATH_ENTRY_HELPER_METHODS,
  PATH_MODULE_SPECIFIERS,
  REACT_CLIENT_DIRECTIVE,
  REACT_SERVER_DIRECTIVE,
  WHOLE_OBJECT_MEMBER_METHODS,
  WORKER_THREADS_MODULE_SPECIFIERS,
} from "../constants.js";
import { getSourcePositionFromLineStarts } from "../path-utils.js";
import type { EsTreeNode } from "../../../lint/utils/es-tree-node.js";
import { isAstNode } from "../../../lint/utils/is-ast-node.js";
import { walkAst } from "../../../lint/utils/walk-ast.js";
import type {
  CodebaseModule,
  ContextImportOptions,
  ExportMemberRecord,
  ExportRecord,
  ImportedBinding,
  ImportRecord,
  MemberObjectReference,
  NamespaceLocalAlias,
  NamespaceLocalObjectAlias,
  NamespaceMemberReference,
  NamespaceObjectAlias,
  ProjectFile,
} from "../types.js";

interface CommentRecord {
  value: string;
  start: number;
  end: number;
}

interface CommonJsStarReExportRecord {
  source: string;
  start: number;
  end: number;
}

interface ShadowRange {
  start: number;
  end: number;
}

interface RuntimeEntryLocals {
  childProcessMethodNames: Set<string>;
  childProcessNamespaceNames: Set<string>;
  nodeModuleNamespaceNames: Set<string>;
  nodeModuleRegisterNames: Set<string>;
  pathHelperMethodNames: Map<string, string>;
  pathNamespaceNames: Set<string>;
  shadowRangesByName: Map<string, ShadowRange[]>;
  workerThreadConstructorNames: Set<string>;
  workerThreadNamespaceNames: Set<string>;
}

const isIdentifierWithName = (value: unknown): value is EsTreeNode & { name: string } =>
  isAstNode(value) && value.type === "Identifier" && typeof value.name === "string";

const getStringLiteralValue = (node: unknown): string | null => {
  if (!isAstNode(node)) return null;
  if (
    (node.type === "Literal" || node.type === "StringLiteral") &&
    typeof node.value === "string"
  ) {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && Array.isArray(node.quasis) && node.quasis.length === 1) {
    const quasi = node.quasis[0];
    if (isAstNode(quasi) && typeof quasi.value === "object" && quasi.value !== null) {
      const value = quasi.value as { cooked?: unknown };
      return typeof value.cooked === "string" ? value.cooked : null;
    }
  }
  return null;
};

const getNodeStart = (node: EsTreeNode): number => {
  if (typeof node.start === "number") return node.start;
  if (Array.isArray(node.range) && typeof node.range[0] === "number") return node.range[0];
  return 0;
};

const getNodeEnd = (node: EsTreeNode): number => {
  if (typeof node.end === "number") return node.end;
  if (Array.isArray(node.range) && typeof node.range[1] === "number") return node.range[1];
  return getNodeStart(node);
};

const collectBindingIdentifierNames = (node: unknown): string[] => {
  if (!isAstNode(node)) return [];
  if (isIdentifierWithName(node)) return [node.name];
  if (node.type === "ObjectPattern") {
    return (node.properties ?? []).flatMap((property: unknown) => {
      if (!isAstNode(property)) return [];
      if (property.type === "Property") return collectBindingIdentifierNames(property.value);
      if (property.type === "RestElement") return collectBindingIdentifierNames(property.argument);
      return [];
    });
  }
  if (node.type === "ArrayPattern") {
    return (node.elements ?? []).flatMap(collectBindingIdentifierNames);
  }
  if (node.type === "AssignmentPattern") {
    return collectBindingIdentifierNames(node.left);
  }
  if (node.type === "RestElement") {
    return collectBindingIdentifierNames(node.argument);
  }
  return [];
};

const findNearestScopeEnd = (node: EsTreeNode): number => {
  let currentNode = node.parent;
  while (currentNode) {
    if (
      currentNode.type === "BlockStatement" ||
      currentNode.type === "Program" ||
      currentNode.type === "StaticBlock"
    ) {
      return getNodeEnd(currentNode);
    }
    currentNode = currentNode.parent;
  }
  return getNodeEnd(node);
};

const addShadowRange = (
  runtimeEntryLocals: RuntimeEntryLocals,
  name: string,
  range: ShadowRange,
): void => {
  const ranges = runtimeEntryLocals.shadowRangesByName.get(name) ?? [];
  ranges.push(range);
  runtimeEntryLocals.shadowRangesByName.set(name, ranges);
};

const isRuntimeLocalShadowed = (
  runtimeEntryLocals: RuntimeEntryLocals,
  name: string,
  position: number,
): boolean =>
  runtimeEntryLocals.shadowRangesByName
    .get(name)
    ?.some((range) => position >= range.start && position <= range.end) ?? false;

const position = (file: ProjectFile, start: number) =>
  getSourcePositionFromLineStarts(file.lineStarts, start);

const getDirectiveValue = (statement: unknown): string | null => {
  if (!isAstNode(statement) || statement.type !== "ExpressionStatement") return null;
  return getStringLiteralValue(statement.expression);
};

const collectDirectives = (program: EsTreeNode): Set<string> => {
  const directives = new Set<string>();
  if (!Array.isArray(program.body)) return directives;
  for (const statement of program.body) {
    const directive = getDirectiveValue(statement);
    if (!directive) break;
    if (directive === REACT_CLIENT_DIRECTIVE || directive === REACT_SERVER_DIRECTIVE) {
      directives.add(directive);
    }
  }
  return directives;
};

const toImportedName = (entry: StaticImportEntry): string => {
  if (entry.importName.kind === "Default") return "default";
  if (entry.importName.kind === "NamespaceObject") return "*";
  return entry.importName.name ?? entry.localName.value;
};

const toImportedBinding = (entry: StaticImportEntry): ImportedBinding => ({
  importedName: toImportedName(entry),
  localName: entry.localName.value,
  isTypeOnly: entry.isType,
  isNamespace: entry.importName.kind === "NamespaceObject",
  start: entry.localName.start,
  end: entry.localName.end,
});

const createImportRecord = (
  file: ProjectFile,
  source: string,
  kind: ImportRecord["kind"],
  bindings: ImportedBinding[],
  start: number,
  end: number,
  isOptional = false,
  context?: ContextImportOptions,
  isTypeOnlyOverride?: boolean,
): ImportRecord => ({
  source,
  bindings,
  kind,
  context,
  isTypeOnly:
    isTypeOnlyOverride ?? (bindings.length > 0 && bindings.every((binding) => binding.isTypeOnly)),
  isSideEffectOnly: bindings.length === 0,
  isOptional,
  start,
  end,
  position: position(file, start),
});

const toPropertyName = (node: unknown): string | null => {
  if (!isAstNode(node)) return null;
  if (typeof node.name === "string") return node.name;
  return getStringLiteralValue(node);
};

const toMemberExpressionPath = (
  node: EsTreeNode,
): { namespace: string; memberPath: string[] } | null => {
  if (isIdentifierWithName(node)) return { namespace: node.name, memberPath: [] };
  if (node.type !== "MemberExpression" || !isAstNode(node.object) || !isAstNode(node.property)) {
    return null;
  }
  const propertyName = toPropertyName(node.property);
  if (!propertyName) return null;
  const parentPath = toMemberExpressionPath(node.object);
  if (!parentPath) return null;
  return {
    namespace: parentPath.namespace,
    memberPath: [...parentPath.memberPath, propertyName],
  };
};

const toQualifiedNamePath = (
  node: EsTreeNode,
): { namespace: string; memberPath: string[] } | null => {
  if (isIdentifierWithName(node)) return { namespace: node.name, memberPath: [] };
  if (
    node.type !== "TSQualifiedName" ||
    !isAstNode(node.left) ||
    !isIdentifierWithName(node.right)
  ) {
    return null;
  }
  const parentPath = toQualifiedNamePath(node.left);
  if (!parentPath) return null;
  return {
    namespace: parentPath.namespace,
    memberPath: [...parentPath.memberPath, node.right.name],
  };
};

const toRequireBinding = (property: EsTreeNode): ImportedBinding | null => {
  const importedName = toPropertyName(property.key);
  if (!importedName) return null;
  const value = isAstNode(property.value) ? property.value : property.key;
  if (isIdentifierWithName(value)) {
    return {
      importedName,
      localName: value.name,
      isTypeOnly: false,
      isNamespace: false,
      start: getNodeStart(value),
      end: getNodeEnd(value),
    };
  }
  if (isAstNode(value) && value.type === "AssignmentPattern" && isIdentifierWithName(value.left)) {
    return {
      importedName,
      localName: value.left.name,
      isTypeOnly: false,
      isNamespace: false,
      start: getNodeStart(value.left),
      end: getNodeEnd(value.left),
    };
  }
  return null;
};

const collectObjectPatternRequireBindings = (pattern: EsTreeNode): ImportedBinding[] => {
  if (!Array.isArray(pattern.properties)) return [];
  return pattern.properties
    .filter(
      (property): property is EsTreeNode => isAstNode(property) && property.type === "Property",
    )
    .map(toRequireBinding)
    .filter((binding): binding is ImportedBinding => Boolean(binding));
};

const collectRequireBindings = (requireCall: EsTreeNode): ImportedBinding[] => {
  const parent = requireCall.parent;
  if (!parent) return [];
  if (
    parent.type === "MemberExpression" &&
    parent.object === requireCall &&
    isAstNode(parent.property)
  ) {
    const grandparent = parent.parent;
    const importedName = toPropertyName(parent.property);
    if (
      importedName &&
      grandparent?.type === "VariableDeclarator" &&
      grandparent.init === parent &&
      isIdentifierWithName(grandparent.id)
    ) {
      return [
        {
          importedName,
          localName: grandparent.id.name,
          isTypeOnly: false,
          isNamespace: false,
          start: getNodeStart(grandparent.id),
          end: getNodeEnd(grandparent.id),
        },
      ];
    }
  }
  if (
    parent.type !== "VariableDeclarator" ||
    parent.init !== requireCall ||
    !isAstNode(parent.id)
  ) {
    return [];
  }
  if (isIdentifierWithName(parent.id)) {
    return [
      {
        importedName: "*",
        localName: parent.id.name,
        isTypeOnly: false,
        isNamespace: true,
        start: getNodeStart(parent.id),
        end: getNodeEnd(parent.id),
      },
    ];
  }
  if (parent.id.type === "ObjectPattern") {
    return collectObjectPatternRequireBindings(parent.id);
  }
  return [];
};

const getImportUseExpression = (importCall: EsTreeNode): EsTreeNode => {
  let expression = importCall;
  let parent = expression.parent;
  if (isAstNode(parent) && parent.type === "AwaitExpression" && parent.argument === expression) {
    expression = parent;
    parent = expression.parent;
  }
  while (
    isAstNode(parent) &&
    (parent.type === "ParenthesizedExpression" || parent.type === "ChainExpression") &&
    parent.expression === expression
  ) {
    expression = parent;
    parent = expression.parent;
  }
  return expression;
};

const toDynamicImportThenBinding = (
  importedName: string,
  localName: string,
  node: EsTreeNode,
): ImportedBinding => ({
  importedName,
  localName,
  isTypeOnly: false,
  isNamespace: false,
  start: getNodeStart(node),
  end: getNodeEnd(node),
});

const collectDynamicImportThenBindings = (importUseExpression: EsTreeNode): ImportedBinding[] => {
  const thenMemberExpression = importUseExpression.parent;
  if (
    !isAstNode(thenMemberExpression) ||
    thenMemberExpression.type !== "MemberExpression" ||
    thenMemberExpression.object !== importUseExpression ||
    !isIdentifierWithName(thenMemberExpression.property) ||
    thenMemberExpression.property.name !== "then"
  ) {
    return [];
  }
  const thenCallExpression = thenMemberExpression.parent;
  if (
    !isAstNode(thenCallExpression) ||
    thenCallExpression.type !== "CallExpression" ||
    thenCallExpression.callee !== thenMemberExpression ||
    !Array.isArray(thenCallExpression.arguments)
  ) {
    return [];
  }
  const callback = thenCallExpression.arguments[0];
  if (
    !isAstNode(callback) ||
    (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") ||
    !Array.isArray(callback.params)
  ) {
    return [];
  }
  const moduleParameter = callback.params[0];
  if (!isAstNode(moduleParameter)) return [];
  if (moduleParameter.type === "ObjectPattern") {
    return collectObjectPatternRequireBindings(moduleParameter);
  }
  if (!isIdentifierWithName(moduleParameter) || !isAstNode(callback.body)) return [];
  const importedNamesByName = new Map<string, ImportedBinding>();
  walkAst(callback.body, (node) => {
    if (node.type !== "MemberExpression") return;
    const memberExpressionPath = toMemberExpressionPath(node);
    if (
      !memberExpressionPath ||
      memberExpressionPath.namespace !== moduleParameter.name ||
      memberExpressionPath.memberPath.length === 0
    ) {
      return;
    }
    const importedName = memberExpressionPath.memberPath[0];
    if (importedName && !importedNamesByName.has(importedName)) {
      importedNamesByName.set(
        importedName,
        toDynamicImportThenBinding(importedName, moduleParameter.name, node),
      );
    }
  });
  return [...importedNamesByName.values()];
};

const isPromiseAllCall = (node: EsTreeNode): boolean =>
  node.type === "CallExpression" &&
  isAstNode(node.callee) &&
  node.callee.type === "MemberExpression" &&
  isIdentifierWithName(node.callee.object) &&
  node.callee.object.name === "Promise" &&
  isIdentifierWithName(node.callee.property) &&
  node.callee.property.name === "all";

const collectDynamicImportPromiseAllBindings = (
  importUseExpression: EsTreeNode,
): ImportedBinding[] => {
  const importElements = importUseExpression.parent;
  if (!isAstNode(importElements) || importElements.type !== "ArrayExpression") return [];
  const promiseAllCall = importElements.parent;
  if (!isAstNode(promiseAllCall) || !isPromiseAllCall(promiseAllCall)) return [];
  const awaitExpression = promiseAllCall.parent;
  if (
    !isAstNode(awaitExpression) ||
    awaitExpression.type !== "AwaitExpression" ||
    awaitExpression.argument !== promiseAllCall
  ) {
    return [];
  }
  const declarator = awaitExpression.parent;
  if (
    !isAstNode(declarator) ||
    declarator.type !== "VariableDeclarator" ||
    declarator.init !== awaitExpression ||
    !isAstNode(declarator.id) ||
    declarator.id.type !== "ArrayPattern" ||
    !Array.isArray(importElements.elements) ||
    !Array.isArray(declarator.id.elements)
  ) {
    return [];
  }
  const importIndex = importElements.elements.findIndex(
    (element) => element === importUseExpression,
  );
  const bindingElement = declarator.id.elements[importIndex];
  if (!isAstNode(bindingElement)) return [];
  if (bindingElement.type === "ObjectPattern") {
    return collectObjectPatternRequireBindings(bindingElement);
  }
  if (isIdentifierWithName(bindingElement)) {
    return [
      {
        importedName: "*",
        localName: bindingElement.name,
        isTypeOnly: false,
        isNamespace: true,
        start: getNodeStart(bindingElement),
        end: getNodeEnd(bindingElement),
      },
    ];
  }
  return [];
};

const collectDynamicImportBindings = (importCall: EsTreeNode): ImportedBinding[] => {
  const importUseExpression = getImportUseExpression(importCall);
  const thenBindings = collectDynamicImportThenBindings(importUseExpression);
  if (thenBindings.length > 0) return thenBindings;
  const promiseAllBindings = collectDynamicImportPromiseAllBindings(importUseExpression);
  if (promiseAllBindings.length > 0) return promiseAllBindings;
  const parent = importUseExpression.parent;
  if (!parent) return [];
  if (
    parent.type === "MemberExpression" &&
    parent.object === importUseExpression &&
    isAstNode(parent.property)
  ) {
    const importedName = toPropertyName(parent.property);
    if (!importedName) return [];
    return [
      {
        importedName,
        localName: importedName,
        isTypeOnly: false,
        isNamespace: false,
        start: getNodeStart(parent.property),
        end: getNodeEnd(parent.property),
      },
    ];
  }
  if (
    parent.type !== "VariableDeclarator" ||
    parent.init !== importUseExpression ||
    !isAstNode(parent.id)
  ) {
    return [];
  }
  if (isIdentifierWithName(parent.id)) {
    return [
      {
        importedName: "*",
        localName: parent.id.name,
        isTypeOnly: false,
        isNamespace: true,
        start: getNodeStart(parent.id),
        end: getNodeEnd(parent.id),
      },
    ];
  }
  if (parent.id.type === "ObjectPattern") {
    return collectObjectPatternRequireBindings(parent.id);
  }
  return [];
};

const getStringArrayLiteralValues = (node: unknown): string[] => {
  const stringValue = getStringLiteralValue(node);
  if (stringValue) return [stringValue];
  if (!isAstNode(node) || node.type !== "ArrayExpression" || !Array.isArray(node.elements)) {
    return [];
  }
  return node.elements
    .map(getStringLiteralValue)
    .filter((value): value is string => Boolean(value));
};

const getTemplateGlobValue = (node: unknown): string | null => {
  if (!isAstNode(node) || node.type !== "TemplateLiteral" || !Array.isArray(node.quasis)) {
    return null;
  }
  const parts = node.quasis.map((quasi) => {
    if (!isAstNode(quasi) || typeof quasi.value !== "object" || quasi.value === null) {
      return "";
    }
    const value = quasi.value as { cooked?: unknown };
    return typeof value.cooked === "string" ? value.cooked : "";
  });
  if (parts.length < 2) return null;
  return parts.reduce((pattern, part, index) => `${pattern}${index > 0 ? "*" : ""}${part}`, "");
};

const getStringConcatenationGlobValue = (node: unknown): string | null => {
  if (!isAstNode(node)) return null;
  const literalValue = getStringLiteralValue(node);
  if (literalValue !== null) return literalValue;
  if (node.type !== "BinaryExpression" || node.operator !== "+") return "*";
  const leftValue = getStringConcatenationGlobValue(node.left);
  const rightValue = getStringConcatenationGlobValue(node.right);
  if (leftValue === null || rightValue === null) return null;
  return `${leftValue}${rightValue}`;
};

const getDynamicImportGlobValue = (node: unknown): string | null => {
  const templatePattern = getTemplateGlobValue(node);
  if (templatePattern) return templatePattern;
  const concatenationPattern = getStringConcatenationGlobValue(node);
  if (!concatenationPattern || !concatenationPattern.includes("*")) return null;
  return concatenationPattern;
};

const getBooleanLiteralValue = (node: unknown): boolean | null => {
  if (!isAstNode(node) || node.type !== "Literal" || typeof node.value !== "boolean") return null;
  return node.value;
};

const getRegexLiteral = (
  node: unknown,
): Pick<ContextImportOptions, "regexPattern" | "regexFlags"> => {
  if (!isAstNode(node) || node.type !== "Literal") return {};
  const regex = node.regex;
  if (!regex || typeof regex !== "object") return {};
  const pattern =
    "pattern" in regex && typeof regex.pattern === "string" ? regex.pattern : undefined;
  const flags = "flags" in regex && typeof regex.flags === "string" ? regex.flags : undefined;
  return {
    regexPattern: pattern,
    regexFlags: flags,
  };
};

const isImportMetaGlobCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression" || !isAstNode(node.callee)) return false;
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed === true ||
    !isAstNode(callee.object) ||
    !isAstNode(callee.property)
  ) {
    return false;
  }
  return (
    callee.object.type === "MetaProperty" &&
    isIdentifierWithName(callee.property) &&
    callee.property.name === "glob"
  );
};

const isRequireContextCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression" || !isAstNode(node.callee)) return false;
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifierWithName(callee.object) &&
    callee.object.name === "require" &&
    isIdentifierWithName(callee.property) &&
    callee.property.name === "context"
  );
};

const collectContextImportRecords = (file: ProjectFile, node: EsTreeNode): ImportRecord[] => {
  if (!Array.isArray(node.arguments)) return [];
  if (isImportMetaGlobCall(node)) {
    return getStringArrayLiteralValues(node.arguments[0]).map((source) =>
      createImportRecord(file, source, "context", [], getNodeStart(node), getNodeEnd(node), false, {
        kind: "glob",
      }),
    );
  }
  if (!isRequireContextCall(node)) return [];
  const source = getStringLiteralValue(node.arguments[0]);
  if (!source) return [];
  const recursive = getBooleanLiteralValue(node.arguments[1]) ?? true;
  return [
    createImportRecord(file, source, "context", [], getNodeStart(node), getNodeEnd(node), false, {
      kind: "require-context",
      recursive,
      ...getRegexLiteral(node.arguments[2]),
    }),
  ];
};

const createDynamicImportRecord = (
  file: ProjectFile,
  node: EsTreeNode,
  sourceNode: unknown,
): ImportRecord | null => {
  const source = getStringLiteralValue(sourceNode);
  if (source) {
    return createImportRecord(
      file,
      source,
      "dynamic",
      collectDynamicImportBindings(node),
      getNodeStart(node),
      getNodeEnd(node),
    );
  }
  const templatePattern = getDynamicImportGlobValue(sourceNode);
  if (!templatePattern) return null;
  return createImportRecord(
    file,
    templatePattern,
    "context",
    [],
    getNodeStart(node),
    getNodeEnd(node),
    false,
    {
      kind: "glob",
    },
  );
};

const toStaticImportRecord = (file: ProjectFile, staticImport: StaticImport): ImportRecord =>
  createImportRecord(
    file,
    staticImport.moduleRequest.value,
    "static",
    staticImport.entries.map(toImportedBinding),
    staticImport.start,
    staticImport.end,
  );

const toExportedName = (entry: StaticExportEntry): string => {
  if (entry.exportName.kind === "Default") return "default";
  if (entry.exportName.kind === "None") return "*";
  return entry.exportName.name ?? "*";
};

const toLocalName = (entry: StaticExportEntry): string | null => {
  if (entry.localName.kind === "Default") return "default";
  return entry.localName.name;
};

const getExportKind = (entry: StaticExportEntry): ExportRecord["symbolKind"] => {
  if (entry.isType) return "type";
  return "unknown";
};

const isReactComponentLikeName = (name: string): boolean => {
  const firstCharacter = name.at(0);
  return Boolean(firstCharacter && firstCharacter.toUpperCase() === firstCharacter);
};

const collectJSDocTags = (comments: CommentRecord[], exportStart: number): Set<string> => {
  const precedingComment = [...comments]
    .filter((comment) => comment.end <= exportStart)
    .sort((first, second) => second.end - first.end)[0];
  if (!precedingComment || exportStart - precedingComment.end > 8) return new Set();
  const tags = [
    ...[...precedingComment.value.matchAll(/@([a-zA-Z][\w-]*)/g)].map((match) => match[1]),
    ...[...precedingComment.value.matchAll(/@api\s+([a-zA-Z][\w-]*)/g)].map((match) => match[1]),
  ].filter((tag): tag is string => Boolean(tag));
  return new Set(tags);
};

const toCommentImportedBinding = (
  importedName: string,
  start: number,
  end: number,
): ImportedBinding => ({
  importedName,
  localName: importedName,
  isTypeOnly: true,
  isNamespace: false,
  start,
  end,
});

const collectCommentImportRecords = (
  file: ProjectFile,
  comments: CommentRecord[],
): ImportRecord[] => {
  const imports: ImportRecord[] = [];
  for (const comment of comments) {
    for (const match of comment.value.matchAll(/<reference\s+path=["']([^"']+)["']/g)) {
      const source = match[1];
      if (!source) continue;
      imports.push(
        createImportRecord(
          file,
          source,
          "comment",
          [],
          comment.start,
          comment.end,
          false,
          undefined,
          true,
        ),
      );
    }
    for (const match of comment.value.matchAll(
      /import\(\s*["']([^"']+)["']\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g,
    )) {
      const source = match[1];
      if (!source) continue;
      const importedName = match[2];
      imports.push(
        createImportRecord(
          file,
          source,
          "comment",
          importedName ? [toCommentImportedBinding(importedName, comment.start, comment.end)] : [],
          comment.start,
          comment.end,
          false,
          undefined,
          true,
        ),
      );
    }
    for (const match of comment.value.matchAll(/@import\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)) {
      const source = match[1];
      if (!source) continue;
      imports.push(
        createImportRecord(
          file,
          source,
          "comment",
          [],
          comment.start,
          comment.end,
          false,
          undefined,
          true,
        ),
      );
    }
  }
  return imports;
};

const toExportRecord = (
  file: ProjectFile,
  entry: StaticExportEntry,
  comments: CommentRecord[],
): ExportRecord => {
  const exportedName = toExportedName(entry);
  const localName = toLocalName(entry);
  return {
    exportedName,
    localName,
    source: entry.moduleRequest?.value ?? null,
    importedName: entry.importName.name ?? (entry.importName.kind === "AllButDefault" ? "*" : null),
    symbolKind: getExportKind(entry),
    isTypeOnly: entry.isType,
    isReExport: Boolean(entry.moduleRequest),
    isCommonJs: false,
    isNamespace: entry.importName.kind === "All" || entry.importName.kind === "AllButDefault",
    isReactComponentLike: isReactComponentLikeName(exportedName),
    jsDocTags: collectJSDocTags(comments, entry.start),
    members: [],
    hasLocalReferences: false,
    start: entry.start,
    end: entry.end,
    position: position(file, entry.start),
  };
};

const toReExportImportRecord = (
  file: ProjectFile,
  entry: StaticExportEntry,
): ImportRecord | null => {
  const source = entry.moduleRequest?.value;
  if (!source) return null;
  const exportedName = toExportedName(entry);
  return createImportRecord(
    file,
    source,
    "re-export",
    [
      {
        importedName: entry.importName.name ?? exportedName,
        localName: exportedName,
        isTypeOnly: entry.isType,
        isNamespace: entry.importName.kind === "All" || entry.importName.kind === "AllButDefault",
        start: entry.start,
        end: entry.end,
      },
    ],
    entry.start,
    entry.end,
  );
};

const isIdentifierDeclaration = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return true;
  if (
    (parent.type === "FunctionDeclaration" || parent.type === "ClassDeclaration") &&
    parent.id === node
  )
    return true;
  if (
    (parent.type === "TSTypeAliasDeclaration" || parent.type === "TSInterfaceDeclaration") &&
    parent.id === node
  )
    return true;
  if (parent.type === "MemberExpression" && parent.property === node && parent.computed !== true) {
    return true;
  }
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier"
  )
    return true;
  if (parent.type === "ExportSpecifier") return true;
  return false;
};

const isExportedVariableDeclarator = (node: EsTreeNode): boolean =>
  node.parent?.type === "VariableDeclaration" &&
  node.parent.parent?.type === "ExportNamedDeclaration";

const collectObjectNamespaceAliases = (node: EsTreeNode): NamespaceObjectAlias[] => {
  if (
    node.type !== "VariableDeclarator" ||
    !isExportedVariableDeclarator(node) ||
    !isIdentifierWithName(node.id) ||
    !isAstNode(node.init) ||
    node.init.type !== "ObjectExpression" ||
    !Array.isArray(node.init.properties)
  ) {
    return [];
  }
  return node.init.properties.flatMap((property) => {
    if (!isAstNode(property) || property.type !== "Property") return [];
    const propertyName = toPropertyName(property.key);
    const value = isAstNode(property.value) ? property.value : property.key;
    if (!propertyName || !isIdentifierWithName(value)) return [];
    return [
      {
        exportName: node.id.name,
        propertyName,
        namespaceLocalName: value.name,
      },
    ];
  });
};

const collectNamespaceLocalAliases = (node: EsTreeNode): NamespaceLocalAlias[] => {
  if (
    node.type !== "VariableDeclarator" ||
    !isIdentifierWithName(node.id) ||
    !isAstNode(node.init)
  ) {
    return [];
  }
  if (isIdentifierWithName(node.init)) {
    return [{ aliasName: node.id.name, namespaceLocalName: node.init.name }];
  }
  if (
    node.init.type === "ConditionalExpression" &&
    isIdentifierWithName(node.init.consequent) &&
    isIdentifierWithName(node.init.alternate)
  ) {
    return [
      { aliasName: node.id.name, namespaceLocalName: node.init.consequent.name },
      { aliasName: node.id.name, namespaceLocalName: node.init.alternate.name },
    ];
  }
  if (node.init.type === "ObjectExpression" && Array.isArray(node.init.properties)) {
    return node.init.properties.flatMap((property) => {
      if (
        !isAstNode(property) ||
        property.type !== "SpreadElement" ||
        !isIdentifierWithName(property.argument)
      ) {
        return [];
      }
      return [{ aliasName: node.id.name, namespaceLocalName: property.argument.name }];
    });
  }
  return [];
};

const collectNamespaceLocalObjectAliases = (node: EsTreeNode): NamespaceLocalObjectAlias[] => {
  if (
    node.type !== "VariableDeclarator" ||
    !isIdentifierWithName(node.id) ||
    !isAstNode(node.init) ||
    node.init.type !== "ObjectExpression" ||
    !Array.isArray(node.init.properties)
  ) {
    return [];
  }
  return node.init.properties.flatMap((property) => {
    if (!isAstNode(property) || property.type !== "Property") return [];
    const propertyName = toPropertyName(property.key);
    const value = isAstNode(property.value) ? property.value : property.key;
    if (!propertyName || !isIdentifierWithName(value)) return [];
    return [
      {
        objectLocalName: node.id.name,
        propertyName,
        namespaceLocalName: value.name,
      },
    ];
  });
};

const collectDestructuredNamespaceReferences = (node: EsTreeNode): NamespaceMemberReference[] => {
  if (
    node.type !== "VariableDeclarator" ||
    !isAstNode(node.id) ||
    node.id.type !== "ObjectPattern" ||
    !isAstNode(node.init) ||
    !Array.isArray(node.id.properties)
  ) {
    return [];
  }
  const initPath = toMemberExpressionPath(node.init);
  if (!initPath) return [];
  return node.id.properties.flatMap((property) => {
    if (!isAstNode(property) || property.type !== "Property") return [];
    const propertyName = toPropertyName(property.key);
    if (!propertyName) return [];
    return [
      {
        namespace: initPath.namespace,
        memberName: propertyName,
        memberPath: [...initPath.memberPath, propertyName],
      },
    ];
  });
};

const collectObjectExportNames = (node: unknown): string[] => {
  if (!isAstNode(node) || node.type !== "ObjectExpression" || !Array.isArray(node.properties)) {
    return [];
  }
  return node.properties.flatMap((property) => {
    if (!isAstNode(property) || property.type !== "Property") return [];
    const propertyName = toPropertyName(property.key);
    return propertyName ? [propertyName] : [];
  });
};

const getRequireCallSource = (node: unknown): string | null => {
  if (
    !isAstNode(node) ||
    node.type !== "CallExpression" ||
    !isIdentifierWithName(node.callee) ||
    node.callee.name !== "require" ||
    !Array.isArray(node.arguments)
  ) {
    return null;
  }
  return getStringLiteralValue(node.arguments[0]);
};

const createRuntimeEntryLocals = (): RuntimeEntryLocals => ({
  childProcessMethodNames: new Set(),
  childProcessNamespaceNames: new Set(),
  nodeModuleNamespaceNames: new Set(),
  nodeModuleRegisterNames: new Set(),
  pathHelperMethodNames: new Map(),
  pathNamespaceNames: new Set(),
  shadowRangesByName: new Map(),
  workerThreadConstructorNames: new Set(),
  workerThreadNamespaceNames: new Set(),
});

const addRuntimeImportDeclarationLocals = (
  node: EsTreeNode,
  runtimeEntryLocals: RuntimeEntryLocals,
): void => {
  if (node.type !== "ImportDeclaration" || !Array.isArray(node.specifiers)) return;
  const source = getStringLiteralValue(node.source);
  if (!source) return;
  for (const specifier of node.specifiers) {
    if (!isAstNode(specifier) || !isIdentifierWithName(specifier.local)) continue;
    if (CHILD_PROCESS_MODULE_SPECIFIERS.has(source)) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        runtimeEntryLocals.childProcessNamespaceNames.add(specifier.local.name);
      } else if (specifier.type === "ImportSpecifier") {
        const importedName = toPropertyName(specifier.imported);
        if (importedName && CHILD_PROCESS_ENTRY_METHODS.has(importedName)) {
          runtimeEntryLocals.childProcessMethodNames.add(specifier.local.name);
        }
      }
    }
    if (NODE_MODULE_SPECIFIERS.has(source)) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        runtimeEntryLocals.nodeModuleNamespaceNames.add(specifier.local.name);
      } else if (specifier.type === "ImportSpecifier") {
        const importedName = toPropertyName(specifier.imported);
        if (importedName === "register") {
          runtimeEntryLocals.nodeModuleRegisterNames.add(specifier.local.name);
        }
      }
    }
    if (PATH_MODULE_SPECIFIERS.has(source)) {
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      ) {
        runtimeEntryLocals.pathNamespaceNames.add(specifier.local.name);
      } else if (specifier.type === "ImportSpecifier") {
        const importedName = toPropertyName(specifier.imported);
        if (importedName && PATH_ENTRY_HELPER_METHODS.has(importedName)) {
          runtimeEntryLocals.pathHelperMethodNames.set(specifier.local.name, importedName);
        }
      }
    }
    if (WORKER_THREADS_MODULE_SPECIFIERS.has(source)) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        runtimeEntryLocals.workerThreadNamespaceNames.add(specifier.local.name);
      } else if (specifier.type === "ImportSpecifier") {
        const importedName = toPropertyName(specifier.imported);
        if (importedName === "Worker") {
          runtimeEntryLocals.workerThreadConstructorNames.add(specifier.local.name);
        }
      }
    }
  }
};

const addRuntimeRequireLocals = (
  node: EsTreeNode,
  runtimeEntryLocals: RuntimeEntryLocals,
): void => {
  if (node.type !== "VariableDeclarator" || !isAstNode(node.id) || !isAstNode(node.init)) {
    return;
  }
  const source = getRequireCallSource(node.init);
  if (!source) return;
  if (isIdentifierWithName(node.id)) {
    if (CHILD_PROCESS_MODULE_SPECIFIERS.has(source)) {
      runtimeEntryLocals.childProcessNamespaceNames.add(node.id.name);
    }
    if (NODE_MODULE_SPECIFIERS.has(source)) {
      runtimeEntryLocals.nodeModuleNamespaceNames.add(node.id.name);
    }
    if (PATH_MODULE_SPECIFIERS.has(source)) {
      runtimeEntryLocals.pathNamespaceNames.add(node.id.name);
    }
    if (WORKER_THREADS_MODULE_SPECIFIERS.has(source)) {
      runtimeEntryLocals.workerThreadNamespaceNames.add(node.id.name);
    }
    return;
  }
  if (node.id.type !== "ObjectPattern") return;
  for (const binding of collectObjectPatternRequireBindings(node.id)) {
    if (
      CHILD_PROCESS_MODULE_SPECIFIERS.has(source) &&
      CHILD_PROCESS_ENTRY_METHODS.has(binding.importedName)
    ) {
      runtimeEntryLocals.childProcessMethodNames.add(binding.localName);
    }
    if (NODE_MODULE_SPECIFIERS.has(source) && binding.importedName === "register") {
      runtimeEntryLocals.nodeModuleRegisterNames.add(binding.localName);
    }
    if (PATH_MODULE_SPECIFIERS.has(source) && PATH_ENTRY_HELPER_METHODS.has(binding.importedName)) {
      runtimeEntryLocals.pathHelperMethodNames.set(binding.localName, binding.importedName);
    }
    if (WORKER_THREADS_MODULE_SPECIFIERS.has(source) && binding.importedName === "Worker") {
      runtimeEntryLocals.workerThreadConstructorNames.add(binding.localName);
    }
  }
};

const getRuntimeRequireBindingNames = (node: EsTreeNode): Set<string> => {
  const bindingNames = new Set<string>();
  if (node.type !== "VariableDeclarator" || !isAstNode(node.id) || !isAstNode(node.init)) {
    return bindingNames;
  }
  const source = getRequireCallSource(node.init);
  if (
    !source ||
    (!CHILD_PROCESS_MODULE_SPECIFIERS.has(source) &&
      !NODE_MODULE_SPECIFIERS.has(source) &&
      !PATH_MODULE_SPECIFIERS.has(source) &&
      !WORKER_THREADS_MODULE_SPECIFIERS.has(source))
  ) {
    return bindingNames;
  }
  for (const bindingName of collectBindingIdentifierNames(node.id)) {
    bindingNames.add(bindingName);
  }
  return bindingNames;
};

const addRuntimeShadowRanges = (node: EsTreeNode, runtimeEntryLocals: RuntimeEntryLocals): void => {
  if (
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression") &&
    isAstNode(node.body)
  ) {
    const range = { start: getNodeStart(node.body), end: getNodeEnd(node.body) };
    for (const bindingName of (node.params ?? []).flatMap(collectBindingIdentifierNames)) {
      addShadowRange(runtimeEntryLocals, bindingName, range);
    }
    if (
      (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") &&
      isIdentifierWithName(node.id)
    ) {
      addShadowRange(runtimeEntryLocals, node.id.name, range);
    }
    return;
  }
  if (node.type === "VariableDeclarator" && isAstNode(node.id)) {
    const runtimeRequireBindingNames = getRuntimeRequireBindingNames(node);
    const range = { start: getNodeStart(node), end: findNearestScopeEnd(node) };
    for (const bindingName of collectBindingIdentifierNames(node.id)) {
      if (!runtimeRequireBindingNames.has(bindingName)) {
        addShadowRange(runtimeEntryLocals, bindingName, range);
      }
    }
    return;
  }
  if (node.type === "CatchClause" && isAstNode(node.param) && isAstNode(node.body)) {
    const range = { start: getNodeStart(node.body), end: getNodeEnd(node.body) };
    for (const bindingName of collectBindingIdentifierNames(node.param)) {
      addShadowRange(runtimeEntryLocals, bindingName, range);
    }
  }
};

const getInlineDirnamePath = (
  node: unknown,
  runtimeEntryLocals: RuntimeEntryLocals,
): string | null => {
  if (
    !isAstNode(node) ||
    node.type !== "CallExpression" ||
    !isAstNode(node.callee) ||
    !Array.isArray(node.arguments) ||
    node.arguments.length < 2
  ) {
    return null;
  }
  let helperName: string | null = null;
  if (
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    runtimeEntryLocals.pathNamespaceNames.has(node.callee.object.name) &&
    !isRuntimeLocalShadowed(
      runtimeEntryLocals,
      node.callee.object.name,
      getNodeStart(node.callee.object),
    ) &&
    isIdentifierWithName(node.callee.property) &&
    PATH_ENTRY_HELPER_METHODS.has(node.callee.property.name)
  ) {
    helperName = node.callee.property.name;
  } else if (
    isIdentifierWithName(node.callee) &&
    !isRuntimeLocalShadowed(runtimeEntryLocals, node.callee.name, getNodeStart(node.callee))
  ) {
    helperName = runtimeEntryLocals.pathHelperMethodNames.get(node.callee.name) ?? null;
  }
  if (!helperName) return null;
  const firstArgument = node.arguments[0];
  if (!isIdentifierWithName(firstArgument) || firstArgument.name !== "__dirname") return null;
  const pathParts = node.arguments.slice(1).map(getStringLiteralValue);
  if (pathParts.some((pathPart) => pathPart === null)) return null;
  const joinedPath = pathParts.join("/").replace(/\/+/g, "/");
  return joinedPath.startsWith(".") || joinedPath.startsWith("/") ? joinedPath : `./${joinedPath}`;
};

const isImportMetaUrlExpression = (node: unknown): boolean =>
  isAstNode(node) &&
  node.type === "MemberExpression" &&
  isAstNode(node.object) &&
  node.object.type === "MetaProperty" &&
  isIdentifierWithName(node.property) &&
  node.property.name === "url";

const createEntryImportRecord = (file: ProjectFile, sourceNode: unknown): ImportRecord | null => {
  if (!isAstNode(sourceNode)) return null;
  const source = getStringLiteralValue(sourceNode);
  if (!source) return null;
  return createImportRecord(
    file,
    source,
    "require-resolve",
    [],
    getNodeStart(sourceNode),
    getNodeEnd(sourceNode),
  );
};

const collectResolverEntryImportRecords = (
  file: ProjectFile,
  node: EsTreeNode,
  runtimeEntryLocals: RuntimeEntryLocals,
): ImportRecord[] => {
  if (node.type !== "CallExpression" || !isAstNode(node.callee) || !Array.isArray(node.arguments)) {
    return [];
  }
  const firstArgument = node.arguments[0];
  if (
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    node.callee.object.name === "require" &&
    !isRuntimeLocalShadowed(runtimeEntryLocals, "require", getNodeStart(node.callee.object)) &&
    isIdentifierWithName(node.callee.property) &&
    node.callee.property.name === "resolve"
  ) {
    const importRecord = createEntryImportRecord(file, firstArgument);
    return importRecord ? [importRecord] : [];
  }
  if (
    node.callee.type === "MemberExpression" &&
    isAstNode(node.callee.object) &&
    node.callee.object.type === "MetaProperty" &&
    isIdentifierWithName(node.callee.property) &&
    node.callee.property.name === "resolve"
  ) {
    const importRecord = createEntryImportRecord(file, firstArgument);
    return importRecord ? [importRecord] : [];
  }
  let isNodeModuleRegisterCall = false;
  if (
    isIdentifierWithName(node.callee) &&
    runtimeEntryLocals.nodeModuleRegisterNames.has(node.callee.name) &&
    !isRuntimeLocalShadowed(runtimeEntryLocals, node.callee.name, getNodeStart(node.callee))
  ) {
    isNodeModuleRegisterCall = true;
  } else if (
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    runtimeEntryLocals.nodeModuleNamespaceNames.has(node.callee.object.name) &&
    !isRuntimeLocalShadowed(
      runtimeEntryLocals,
      node.callee.object.name,
      getNodeStart(node.callee.object),
    ) &&
    isIdentifierWithName(node.callee.property) &&
    node.callee.property.name === "register"
  ) {
    isNodeModuleRegisterCall = true;
  }
  if (!isNodeModuleRegisterCall) return [];
  const source = getStringLiteralValue(firstArgument);
  const secondArgument = node.arguments[1];
  if (!source || (source.startsWith(".") && !isImportMetaUrlExpression(secondArgument))) {
    return [];
  }
  const importRecord = createEntryImportRecord(file, firstArgument);
  return importRecord ? [importRecord] : [];
};

const collectRuntimeEntryImportRecords = (
  file: ProjectFile,
  node: EsTreeNode,
  runtimeEntryLocals: RuntimeEntryLocals,
): ImportRecord[] => {
  if (node.type !== "CallExpression" || !isAstNode(node.callee) || !Array.isArray(node.arguments)) {
    return [];
  }
  let isChildProcessEntryCall = false;
  if (
    isIdentifierWithName(node.callee) &&
    runtimeEntryLocals.childProcessMethodNames.has(node.callee.name) &&
    !isRuntimeLocalShadowed(runtimeEntryLocals, node.callee.name, getNodeStart(node.callee))
  ) {
    isChildProcessEntryCall = true;
  } else if (
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    runtimeEntryLocals.childProcessNamespaceNames.has(node.callee.object.name) &&
    !isRuntimeLocalShadowed(
      runtimeEntryLocals,
      node.callee.object.name,
      getNodeStart(node.callee.object),
    ) &&
    isIdentifierWithName(node.callee.property) &&
    CHILD_PROCESS_ENTRY_METHODS.has(node.callee.property.name)
  ) {
    isChildProcessEntryCall = true;
  }
  if (!isChildProcessEntryCall) return [];
  const source = getInlineDirnamePath(node.arguments[0], runtimeEntryLocals);
  if (!source) return [];
  return [
    createImportRecord(
      file,
      source,
      "require-resolve",
      [],
      getNodeStart(node.arguments[0]),
      getNodeEnd(node.arguments[0]),
    ),
  ];
};

const collectWorkerThreadEntryImportRecords = (
  file: ProjectFile,
  node: EsTreeNode,
  runtimeEntryLocals: RuntimeEntryLocals,
): ImportRecord[] => {
  if (node.type !== "NewExpression" || !isAstNode(node.callee) || !Array.isArray(node.arguments)) {
    return [];
  }
  let isWorkerThreadConstructor = false;
  if (
    isIdentifierWithName(node.callee) &&
    runtimeEntryLocals.workerThreadConstructorNames.has(node.callee.name) &&
    !isRuntimeLocalShadowed(runtimeEntryLocals, node.callee.name, getNodeStart(node.callee))
  ) {
    isWorkerThreadConstructor = true;
  } else if (
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    runtimeEntryLocals.workerThreadNamespaceNames.has(node.callee.object.name) &&
    !isRuntimeLocalShadowed(
      runtimeEntryLocals,
      node.callee.object.name,
      getNodeStart(node.callee.object),
    ) &&
    isIdentifierWithName(node.callee.property) &&
    node.callee.property.name === "Worker"
  ) {
    isWorkerThreadConstructor = true;
  }
  if (!isWorkerThreadConstructor) return [];
  const source = getInlineDirnamePath(node.arguments[0], runtimeEntryLocals);
  if (!source) return [];
  return [
    createImportRecord(
      file,
      source,
      "require-resolve",
      [],
      getNodeStart(node.arguments[0]),
      getNodeEnd(node.arguments[0]),
    ),
  ];
};

const collectRequireSpreadSources = (node: unknown): CommonJsStarReExportRecord[] => {
  if (!isAstNode(node) || node.type !== "ObjectExpression" || !Array.isArray(node.properties)) {
    return [];
  }
  return node.properties.flatMap((property) => {
    if (!isAstNode(property) || property.type !== "SpreadElement") return [];
    const source = getRequireCallSource(property.argument);
    return source ? [{ source, start: getNodeStart(property), end: getNodeEnd(property) }] : [];
  });
};

const collectCommonJsExportNames = (node: EsTreeNode): string[] => {
  if (node.type !== "AssignmentExpression" || node.operator !== "=" || !isAstNode(node.left)) {
    return [];
  }
  const leftPath = toMemberExpressionPath(node.left);
  if (!leftPath) return [];
  if (leftPath.namespace === "exports" && leftPath.memberPath.length === 1) {
    const exportName = leftPath.memberPath[0];
    return exportName ? [exportName] : [];
  }
  if (leftPath.namespace === "module" && leftPath.memberPath[0] === "exports") {
    if (leftPath.memberPath.length === 2) {
      const exportName = leftPath.memberPath[1];
      return exportName ? [exportName] : [];
    }
    if (leftPath.memberPath.length === 1) {
      const objectExportNames = collectObjectExportNames(node.right);
      if (collectRequireSpreadSources(node.right).length > 0) return objectExportNames;
      if (getRequireCallSource(node.right)) return [];
      return objectExportNames.length > 0 ? objectExportNames : ["default"];
    }
  }
  return [];
};

const collectCommonJsStarReExports = (node: EsTreeNode): CommonJsStarReExportRecord[] => {
  if (node.type !== "AssignmentExpression" || node.operator !== "=" || !isAstNode(node.left)) {
    return [];
  }
  const leftPath = toMemberExpressionPath(node.left);
  if (
    !leftPath ||
    leftPath.namespace !== "module" ||
    leftPath.memberPath[0] !== "exports" ||
    leftPath.memberPath.length !== 1
  ) {
    return [];
  }
  const directSource = getRequireCallSource(node.right);
  if (directSource) {
    return [{ source: directSource, start: getNodeStart(node), end: getNodeEnd(node) }];
  }
  return collectRequireSpreadSources(node.right);
};

const collectCommonJsReExportRecords = (file: ProjectFile, node: EsTreeNode): ImportRecord[] => {
  if (
    node.type !== "AssignmentExpression" ||
    node.operator !== "=" ||
    !isAstNode(node.left) ||
    !isAstNode(node.right)
  ) {
    return [];
  }
  const leftPath = toMemberExpressionPath(node.left);
  if (
    !leftPath ||
    leftPath.namespace !== "module" ||
    leftPath.memberPath[0] !== "exports" ||
    leftPath.memberPath.length !== 2
  ) {
    return [];
  }
  const exportName = leftPath.memberPath[1];
  if (
    !exportName ||
    node.right.type !== "MemberExpression" ||
    !isAstNode(node.right.object) ||
    node.right.object.type !== "CallExpression" ||
    !isIdentifierWithName(node.right.object.callee) ||
    node.right.object.callee.name !== "require" ||
    !isAstNode(node.right.property) ||
    !Array.isArray(node.right.object.arguments)
  ) {
    return [];
  }
  const source = getStringLiteralValue(node.right.object.arguments[0]);
  const importedName = toPropertyName(node.right.property);
  if (!source || !importedName) return [];
  return [
    createImportRecord(
      file,
      source,
      "re-export",
      [
        {
          importedName,
          localName: exportName,
          isTypeOnly: false,
          isNamespace: false,
          start: getNodeStart(node.right.property),
          end: getNodeEnd(node.right.property),
        },
      ],
      getNodeStart(node),
      getNodeEnd(node),
    ),
  ];
};

const toMemberObjectReference = (node: unknown): MemberObjectReference | null => {
  if (!isAstNode(node)) return null;
  const memberExpressionPath = toMemberExpressionPath(node);
  return memberExpressionPath
    ? {
        namespace: memberExpressionPath.namespace,
        memberPath: memberExpressionPath.memberPath,
      }
    : null;
};

const collectWholeObjectMemberReferences = (node: EsTreeNode): MemberObjectReference[] => {
  if (
    node.type === "CallExpression" &&
    isAstNode(node.callee) &&
    node.callee.type === "MemberExpression" &&
    isIdentifierWithName(node.callee.object) &&
    node.callee.object.name === "Object" &&
    isIdentifierWithName(node.callee.property) &&
    WHOLE_OBJECT_MEMBER_METHODS.has(node.callee.property.name) &&
    Array.isArray(node.arguments)
  ) {
    return node.arguments.flatMap((argument) => {
      const reference = toMemberObjectReference(argument);
      return reference ? [reference] : [];
    });
  }
  if (node.type === "SpreadElement") {
    const reference = toMemberObjectReference(node.argument);
    return reference ? [reference] : [];
  }
  return [];
};

const toTypeImportQualifierName = (node: unknown): string | null => {
  if (!isAstNode(node)) return null;
  if (isIdentifierWithName(node)) return node.name;
  if (node.type !== "TSQualifiedName") return null;
  return toTypeImportQualifierName(node.left);
};

const collectTypeImportRecords = (file: ProjectFile, node: EsTreeNode): ImportRecord[] => {
  if (node.type !== "TSImportType") return [];
  const source = getStringLiteralValue(node.source);
  if (!source) return [];
  const qualifierName = toTypeImportQualifierName(node.qualifier);
  return [
    createImportRecord(
      file,
      source,
      "comment",
      qualifierName
        ? [toCommentImportedBinding(qualifierName, getNodeStart(node), getNodeEnd(node))]
        : [],
      getNodeStart(node),
      getNodeEnd(node),
      false,
      undefined,
      true,
    ),
  ];
};

const collectTypeScriptImportEqualsRecords = (
  file: ProjectFile,
  node: EsTreeNode,
): ImportRecord[] => {
  if (
    node.type !== "TSImportEqualsDeclaration" ||
    !isIdentifierWithName(node.id) ||
    !isAstNode(node.moduleReference) ||
    node.moduleReference.type !== "TSExternalModuleReference"
  ) {
    return [];
  }
  const source = getStringLiteralValue(node.moduleReference.expression);
  if (!source) return [];
  return [
    createImportRecord(
      file,
      source,
      "require",
      [
        {
          importedName: "*",
          localName: node.id.name,
          isTypeOnly: node.importKind === "type",
          isNamespace: true,
          start: getNodeStart(node.id),
          end: getNodeEnd(node.id),
        },
      ],
      getNodeStart(node),
      getNodeEnd(node),
      false,
      undefined,
      node.importKind === "type",
    ),
  ];
};

const collectAstFacts = (
  file: ProjectFile,
  program: EsTreeNode,
): {
  imports: ImportRecord[];
  usedIdentifiers: Set<string>;
  namespaceMemberReferences: NamespaceMemberReference[];
  memberObjectReferences: MemberObjectReference[];
  namespaceObjectAliases: NamespaceObjectAlias[];
  namespaceLocalAliases: NamespaceLocalAlias[];
  namespaceLocalObjectAliases: NamespaceLocalObjectAlias[];
  cjsExportNames: Set<string>;
  cjsStarReExports: CommonJsStarReExportRecord[];
  membersByExportName: Map<string, ExportMemberRecord[]>;
} => {
  const imports: ImportRecord[] = [];
  const usedIdentifiers = new Set<string>();
  const namespaceMemberReferences: NamespaceMemberReference[] = [];
  const memberObjectReferences: MemberObjectReference[] = [];
  const namespaceObjectAliases: NamespaceObjectAlias[] = [];
  const namespaceLocalAliases: NamespaceLocalAlias[] = [];
  const namespaceLocalObjectAliases: NamespaceLocalObjectAlias[] = [];
  const cjsExportNames = new Set<string>();
  const cjsStarReExports: CommonJsStarReExportRecord[] = [];
  const runtimeEntryLocals = createRuntimeEntryLocals();
  const membersByExportName = new Map<string, ExportMemberRecord[]>();

  walkAst(program, (node) => {
    addRuntimeImportDeclarationLocals(node, runtimeEntryLocals);
    addRuntimeShadowRanges(node, runtimeEntryLocals);

    if (
      node.type === "Identifier" &&
      typeof node.name === "string" &&
      !isIdentifierDeclaration(node)
    ) {
      usedIdentifiers.add(node.name);
    }

    if (node.type === "JSXIdentifier" && typeof node.name === "string") {
      usedIdentifiers.add(node.name);
    }

    memberObjectReferences.push(...collectWholeObjectMemberReferences(node));
    imports.push(...collectTypeImportRecords(file, node));
    imports.push(...collectTypeScriptImportEqualsRecords(file, node));

    if (node.type === "CallExpression" && isAstNode(node.callee)) {
      imports.push(...collectResolverEntryImportRecords(file, node, runtimeEntryLocals));
      imports.push(...collectRuntimeEntryImportRecords(file, node, runtimeEntryLocals));
      imports.push(...collectContextImportRecords(file, node));
      if (node.callee.type === "Import" && Array.isArray(node.arguments)) {
        const dynamicImportRecord = createDynamicImportRecord(file, node, node.arguments[0]);
        if (dynamicImportRecord) imports.push(dynamicImportRecord);
      }
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        Array.isArray(node.arguments)
      ) {
        const source = getStringLiteralValue(node.arguments[0]);
        if (source)
          imports.push(
            createImportRecord(
              file,
              source,
              "require",
              collectRequireBindings(node),
              getNodeStart(node),
              getNodeEnd(node),
            ),
          );
      }
    }

    if (node.type === "ImportExpression") {
      const dynamicImportRecord = createDynamicImportRecord(file, node, node.source);
      if (dynamicImportRecord) imports.push(dynamicImportRecord);
    }

    if (
      node.type === "NewExpression" &&
      isAstNode(node.callee) &&
      node.callee.type === "Identifier" &&
      node.callee.name === "URL" &&
      Array.isArray(node.arguments)
    ) {
      const source = getStringLiteralValue(node.arguments[0]);
      if (source)
        imports.push(
          createImportRecord(file, source, "asset", [], getNodeStart(node), getNodeEnd(node)),
        );
    }

    imports.push(...collectWorkerThreadEntryImportRecords(file, node, runtimeEntryLocals));

    if (node.type === "VariableDeclarator") {
      addRuntimeRequireLocals(node, runtimeEntryLocals);
      namespaceObjectAliases.push(...collectObjectNamespaceAliases(node));
      namespaceLocalAliases.push(...collectNamespaceLocalAliases(node));
      namespaceLocalObjectAliases.push(...collectNamespaceLocalObjectAliases(node));
      namespaceMemberReferences.push(...collectDestructuredNamespaceReferences(node));
    }

    if (node.type === "TSQualifiedName") {
      const qualifiedNamePath = toQualifiedNamePath(node);
      if (qualifiedNamePath && qualifiedNamePath.memberPath.length > 0) {
        namespaceMemberReferences.push({
          namespace: qualifiedNamePath.namespace,
          memberName: qualifiedNamePath.memberPath.at(-1) ?? "",
          memberPath: qualifiedNamePath.memberPath,
        });
      }
    }

    if (node.type === "AssignmentExpression") {
      imports.push(...collectCommonJsReExportRecords(file, node));
      cjsStarReExports.push(...collectCommonJsStarReExports(node));
      for (const exportName of collectCommonJsExportNames(node)) {
        cjsExportNames.add(exportName);
      }
    }

    if (node.type === "MemberExpression" && isAstNode(node.object) && isAstNode(node.property)) {
      const memberExpressionPath = toMemberExpressionPath(node);
      if (memberExpressionPath && memberExpressionPath.memberPath.length > 0) {
        namespaceMemberReferences.push({
          namespace: memberExpressionPath.namespace,
          memberName: memberExpressionPath.memberPath.at(-1) ?? "",
          memberPath: memberExpressionPath.memberPath,
        });
        if (
          memberExpressionPath.namespace === "exports" &&
          memberExpressionPath.memberPath.length === 1
        ) {
          cjsExportNames.add(memberExpressionPath.memberPath[0] ?? "");
        }
      }
    }

    if (
      (node.type === "TSEnumDeclaration" || node.type === "ClassDeclaration") &&
      isAstNode(node.id) &&
      typeof node.id.name === "string"
    ) {
      const members: ExportMemberRecord[] = [];
      const rawMembers =
        node.type === "TSEnumDeclaration" &&
        isAstNode(node.body) &&
        Array.isArray(node.body.members)
          ? node.body.members
          : node.type === "ClassDeclaration" &&
              isAstNode(node.body) &&
              Array.isArray(node.body.body)
            ? node.body.body
            : [];
      for (const member of rawMembers) {
        if (!isAstNode(member)) continue;
        if (node.type === "ClassDeclaration" && member.static !== true) continue;
        const key = isAstNode(member.id) ? member.id : isAstNode(member.key) ? member.key : null;
        const name = key && typeof key.name === "string" ? key.name : getStringLiteralValue(key);
        if (name) {
          members.push({
            name,
            kind: node.type === "TSEnumDeclaration" ? "enum" : "class",
            start: getNodeStart(member),
            end: getNodeEnd(member),
            position: position(file, getNodeStart(member)),
            jsDocTags: new Set(),
            hasLocalReferences: false,
          });
        }
      }
      membersByExportName.set(node.id.name, members);
    }
  });

  return {
    imports,
    usedIdentifiers,
    namespaceMemberReferences,
    memberObjectReferences,
    namespaceObjectAliases,
    namespaceLocalAliases,
    namespaceLocalObjectAliases,
    cjsExportNames,
    cjsStarReExports,
    membersByExportName,
  };
};

const enrichExportsFromAst = (
  exports: ExportRecord[],
  membersByExportName: ReadonlyMap<string, ExportMemberRecord[]>,
  usedIdentifiers: ReadonlySet<string>,
): ExportRecord[] =>
  exports.map((exportRecord) => {
    const localName = exportRecord.localName ?? exportRecord.exportedName;
    return {
      ...exportRecord,
      symbolKind:
        exportRecord.symbolKind === "unknown" && membersByExportName.has(localName)
          ? membersByExportName.get(localName)?.[0]?.kind === "enum"
            ? "enum"
            : "class"
          : exportRecord.symbolKind,
      members: membersByExportName.get(localName) ?? [],
      hasLocalReferences: exportRecord.isCommonJs ? false : usedIdentifiers.has(localName),
    };
  });

export const extractModule = (file: ProjectFile): CodebaseModule => {
  const parseResult = parseSync(file.filePath, file.sourceText, {
    sourceType: "unambiguous",
    range: true,
  });
  const comments = parseResult.comments as CommentRecord[];
  const program = parseResult.program as EsTreeNode;
  const astFacts = collectAstFacts(file, program);
  const commentImports = collectCommentImportRecords(file, comments);
  const staticImports = parseResult.module.staticImports.map((staticImport) =>
    toStaticImportRecord(file, staticImport),
  );
  const reExportImports = parseResult.module.staticExports
    .flatMap((staticExport) => staticExport.entries)
    .map((entry) => toReExportImportRecord(file, entry))
    .filter((importRecord): importRecord is ImportRecord => Boolean(importRecord));
  const rawExports = parseResult.module.staticExports
    .flatMap((staticExport) => staticExport.entries)
    .map((entry) => toExportRecord(file, entry, comments));
  for (const cjsExportName of astFacts.cjsExportNames) {
    rawExports.push({
      exportedName: cjsExportName,
      localName: cjsExportName,
      source: null,
      importedName: null,
      symbolKind: "value",
      isTypeOnly: false,
      isReExport: false,
      isCommonJs: true,
      isNamespace: false,
      isReactComponentLike: isReactComponentLikeName(cjsExportName),
      jsDocTags: new Set(),
      members: [],
      hasLocalReferences: false,
      start: 0,
      end: 0,
      position: { line: 1, column: 1 },
    });
  }
  const cjsStarReExportImports = astFacts.cjsStarReExports.map((record) =>
    createImportRecord(
      file,
      record.source,
      "re-export",
      [
        {
          importedName: "*",
          localName: "*",
          isTypeOnly: false,
          isNamespace: true,
          start: record.start,
          end: record.end,
        },
      ],
      record.start,
      record.end,
    ),
  );
  for (const record of astFacts.cjsStarReExports) {
    rawExports.push({
      exportedName: "*",
      localName: null,
      source: record.source,
      importedName: "*",
      symbolKind: "unknown",
      isTypeOnly: false,
      isReExport: true,
      isCommonJs: true,
      isNamespace: true,
      isReactComponentLike: false,
      jsDocTags: new Set(),
      members: [],
      hasLocalReferences: false,
      start: record.start,
      end: record.end,
      position: position(file, record.start),
    });
  }

  return {
    file,
    imports: [
      ...staticImports,
      ...commentImports,
      ...astFacts.imports,
      ...reExportImports,
      ...cjsStarReExportImports,
    ],
    exports: enrichExportsFromAst(
      rawExports,
      astFacts.membersByExportName,
      astFacts.usedIdentifiers,
    ),
    directives: collectDirectives(program),
    usedIdentifiers: astFacts.usedIdentifiers,
    namespaceMemberReferences: astFacts.namespaceMemberReferences,
    memberObjectReferences: astFacts.memberObjectReferences,
    namespaceObjectAliases: astFacts.namespaceObjectAliases,
    namespaceLocalAliases: astFacts.namespaceLocalAliases,
    namespaceLocalObjectAliases: astFacts.namespaceLocalObjectAliases,
    cjsExportNames: astFacts.cjsExportNames,
    parseErrors: parseResult.errors.map((error) => error.message),
  };
};

export const extractModules = (files: ProjectFile[]): CodebaseModule[] => files.map(extractModule);
