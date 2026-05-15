import type { EsTreeNode } from "./es-tree-node.js";
import { getPropertyName } from "./get-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getObjectProperty = (
  objectExpression: EsTreeNode,
  propertyName: string,
): EsTreeNode | null => {
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return null;
  for (const property of objectExpression.properties ?? []) {
    if (getPropertyName(property) === propertyName) return property;
  }
  return null;
};
