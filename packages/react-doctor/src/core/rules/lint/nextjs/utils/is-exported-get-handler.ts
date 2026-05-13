import type { EsTreeNode } from "../../utils/index.js";
import { isNodeOfType } from "../../utils/index.js";

export const isExportedGetHandler = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ExportNamedDeclaration")) return false;
  const declaration = node.declaration;
  if (!declaration) return false;

  if (isNodeOfType(declaration, "FunctionDeclaration")) {
    return declaration.id?.name === "GET";
  }

  if (isNodeOfType(declaration, "VariableDeclaration")) {
    for (const declarator of declaration.declarations ?? []) {
      if (isNodeOfType(declarator.id, "Identifier") && declarator.id.name === "GET") {
        return true;
      }
    }
  }

  return false;
};
