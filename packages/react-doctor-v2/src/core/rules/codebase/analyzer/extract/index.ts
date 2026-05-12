import { parseSync } from "oxc-parser";
import type { StaticExportEntry, StaticImport, StaticImportEntry } from "oxc-parser";
import { REACT_CLIENT_DIRECTIVE, REACT_SERVER_DIRECTIVE } from "../constants.js";
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

const collectDynamicImportBindings = (importCall: EsTreeNode): ImportedBinding[] => {
  const importUseExpression = getImportUseExpression(importCall);
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
  const templatePattern = getTemplateGlobValue(sourceNode);
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
  return new Set(
    [...precedingComment.value.matchAll(/@([a-zA-Z][\w-]*)/g)]
      .map((match) => match[1])
      .filter(Boolean),
  );
};

const collectCommentImportRecords = (
  file: ProjectFile,
  comments: CommentRecord[],
): ImportRecord[] => {
  const imports: ImportRecord[] = [];
  for (const comment of comments) {
    const matches = [
      ...comment.value.matchAll(/<reference\s+path=["']([^"']+)["']/g),
      ...comment.value.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
      ...comment.value.matchAll(/@import\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g),
    ];
    for (const match of matches) {
      const source = match[1];
      if (!source) continue;
      imports.push(
        createImportRecord(
          file,
          source,
          "static",
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

const collectAstFacts = (
  file: ProjectFile,
  program: EsTreeNode,
): {
  imports: ImportRecord[];
  usedIdentifiers: Set<string>;
  namespaceMemberReferences: NamespaceMemberReference[];
  namespaceObjectAliases: NamespaceObjectAlias[];
  namespaceLocalAliases: NamespaceLocalAlias[];
  namespaceLocalObjectAliases: NamespaceLocalObjectAlias[];
  cjsExportNames: Set<string>;
  membersByExportName: Map<string, ExportMemberRecord[]>;
} => {
  const imports: ImportRecord[] = [];
  const usedIdentifiers = new Set<string>();
  const namespaceMemberReferences: NamespaceMemberReference[] = [];
  const namespaceObjectAliases: NamespaceObjectAlias[] = [];
  const namespaceLocalAliases: NamespaceLocalAlias[] = [];
  const namespaceLocalObjectAliases: NamespaceLocalObjectAlias[] = [];
  const cjsExportNames = new Set<string>();
  const membersByExportName = new Map<string, ExportMemberRecord[]>();

  walkAst(program, (node) => {
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

    if (node.type === "CallExpression" && isAstNode(node.callee)) {
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
      if (
        node.callee.type === "MemberExpression" &&
        isAstNode(node.callee.object) &&
        isAstNode(node.callee.property) &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "require" &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "resolve" &&
        Array.isArray(node.arguments)
      ) {
        const source = getStringLiteralValue(node.arguments[0]);
        if (source)
          imports.push(
            createImportRecord(
              file,
              source,
              "require-resolve",
              [],
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

    if (node.type === "VariableDeclarator") {
      namespaceObjectAliases.push(...collectObjectNamespaceAliases(node));
      namespaceLocalAliases.push(...collectNamespaceLocalAliases(node));
      namespaceLocalObjectAliases.push(...collectNamespaceLocalObjectAliases(node));
      namespaceMemberReferences.push(...collectDestructuredNamespaceReferences(node));
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
      if (
        isIdentifierWithName(node.object) &&
        node.object.name === "module" &&
        isIdentifierWithName(node.property) &&
        node.property.name === "exports"
      ) {
        cjsExportNames.add("default");
      }
    }

    if (
      (node.type === "TSEnumDeclaration" || node.type === "ClassDeclaration") &&
      isAstNode(node.id) &&
      typeof node.id.name === "string"
    ) {
      const members: ExportMemberRecord[] = [];
      const rawMembers =
        node.type === "TSEnumDeclaration" && isAstNode(node.body) && Array.isArray(node.body.members)
          ? node.body.members
          : node.type === "ClassDeclaration" && isAstNode(node.body) && Array.isArray(node.body.body)
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
    namespaceObjectAliases,
    namespaceLocalAliases,
    namespaceLocalObjectAliases,
    cjsExportNames,
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
      hasLocalReferences: usedIdentifiers.has(localName),
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

  return {
    file,
    imports: [...staticImports, ...commentImports, ...astFacts.imports, ...reExportImports],
    exports: enrichExportsFromAst(
      rawExports,
      astFacts.membersByExportName,
      astFacts.usedIdentifiers,
    ),
    directives: collectDirectives(program),
    usedIdentifiers: astFacts.usedIdentifiers,
    namespaceMemberReferences: astFacts.namespaceMemberReferences,
    namespaceObjectAliases: astFacts.namespaceObjectAliases,
    namespaceLocalAliases: astFacts.namespaceLocalAliases,
    namespaceLocalObjectAliases: astFacts.namespaceLocalObjectAliases,
    cjsExportNames: astFacts.cjsExportNames,
    parseErrors: parseResult.errors.map((error) => error.message),
  };
};

export const extractModules = (files: ProjectFile[]): CodebaseModule[] => files.map(extractModule);
