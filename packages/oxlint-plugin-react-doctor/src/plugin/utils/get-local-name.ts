import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getLocalName = (specifier: EsTreeNode): string | null =>
  (isNodeOfType(specifier, "ImportSpecifier") ||
    isNodeOfType(specifier, "ImportDefaultSpecifier") ||
    isNodeOfType(specifier, "ImportNamespaceSpecifier")) &&
  isNodeOfType(specifier.local, "Identifier")
    ? specifier.local.name
    : null;
