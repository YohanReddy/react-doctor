import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getNamespaceImportName = (specifier: EsTreeNode): string | null => {
  if (!isNodeOfType(specifier, "ImportNamespaceSpecifier")) return null;
  return isNodeOfType(specifier.local, "Identifier") ? specifier.local.name : null;
};
