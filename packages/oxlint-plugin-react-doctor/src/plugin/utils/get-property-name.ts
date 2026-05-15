import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getPropertyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "Property")) return null;
  if (isNodeOfType(node.key, "Identifier")) return node.key.name;
  if (isNodeOfType(node.key, "Literal") && typeof node.key.value === "string") {
    return node.key.value;
  }
  return null;
};
