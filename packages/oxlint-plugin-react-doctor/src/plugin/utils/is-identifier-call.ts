import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isIdentifierCall = (
  node: EsTreeNode | null | undefined,
  names: Set<string>,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  names.has(node.callee.name);
