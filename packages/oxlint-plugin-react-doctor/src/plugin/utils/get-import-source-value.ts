import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getImportSourceValue = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "ImportDeclaration")) return null;
  const value = node.source?.value;
  return typeof value === "string" ? value : null;
};
