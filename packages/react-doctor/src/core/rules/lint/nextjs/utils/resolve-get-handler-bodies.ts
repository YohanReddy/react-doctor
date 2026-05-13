import type { EsTreeNode } from "../../utils/index.js";
import { isNodeOfType } from "../../utils/index.js";
import { collectChainedGetHandlerBodies } from "./collect-chained-get-handler-bodies.js";

const MAX_BINDING_RESOLUTION_DEPTH = 4;

const resolveBodiesFromExpression = (
  expression: EsTreeNode,
  resolveBinding: (identifierName: string) => EsTreeNode | null,
  remainingDepth: number,
): EsTreeNode[] => {
  if (remainingDepth <= 0) return [];

  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return expression.body ? [expression.body] : [];
  }

  if (isNodeOfType(expression, "CallExpression")) {
    for (const callArgument of expression.arguments ?? []) {
      if (!isNodeOfType(callArgument, "Identifier")) continue;
      const argumentInit = resolveBinding(callArgument.name);
      if (!argumentInit) continue;
      const bodies = collectChainedGetHandlerBodies(argumentInit);
      if (bodies.length > 0) return bodies;
    }
    return [];
  }

  if (isNodeOfType(expression, "Identifier")) {
    const init = resolveBinding(expression.name);
    if (!init) return [];
    return resolveBodiesFromExpression(init, resolveBinding, remainingDepth - 1);
  }

  return [];
};

// Returns every handler body that may run when the file's exported `GET`
// route handler is invoked. Direct shapes (`export async function GET`,
// `export const GET = async () => {}`) return a single body. Framework
// adapter shapes (`export const GET = handle(app)` where `app` is a
// chained router builder) return every callback passed to `.get(path, fn)`
// on that chain. Returns an empty array when the export is not named GET
// or the body cannot be confidently resolved.
export const resolveGetHandlerBodies = (
  exportNode: EsTreeNode,
  resolveBinding: (identifierName: string) => EsTreeNode | null,
): EsTreeNode[] => {
  if (!isNodeOfType(exportNode, "ExportNamedDeclaration")) return [];
  const declaration = exportNode.declaration;
  if (!declaration) return [];

  if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id?.name === "GET") {
    return declaration.body ? [declaration.body] : [];
  }

  if (!isNodeOfType(declaration, "VariableDeclaration")) return [];

  for (const declarator of declaration.declarations ?? []) {
    if (!isNodeOfType(declarator.id, "Identifier") || declarator.id.name !== "GET") continue;
    if (!declarator.init) return [];
    return resolveBodiesFromExpression(
      declarator.init,
      resolveBinding,
      MAX_BINDING_RESOLUTION_DEPTH,
    );
  }

  return [];
};
