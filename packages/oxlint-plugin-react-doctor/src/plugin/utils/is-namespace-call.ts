import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNamespaceCall = (
  node: EsTreeNode | null | undefined,
  namespaceNames: Set<string>,
  importedName: string,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.object, "Identifier") &&
  namespaceNames.has(node.callee.object.name) &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === importedName;
