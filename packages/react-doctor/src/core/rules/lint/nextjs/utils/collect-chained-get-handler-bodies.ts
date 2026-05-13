import type { EsTreeNode } from "../../utils/index.js";
import { isNodeOfType } from "../../utils/index.js";

const isGetMethodCall = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  if (!isNodeOfType(callExpression.callee, "MemberExpression")) return false;
  if (!isNodeOfType(callExpression.callee.property, "Identifier")) return false;
  return callExpression.callee.property.name === "get";
};

const isStringLikeNode = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && typeof node.value === "string") ||
  isNodeOfType(node, "TemplateLiteral");

const getHandlerCallbackBody = (callExpression: EsTreeNode): EsTreeNode | null => {
  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length < 2) return null;
  if (!isStringLikeNode(callArguments[0])) return null;
  const lastArgument = callArguments[callArguments.length - 1];
  if (
    (isNodeOfType(lastArgument, "ArrowFunctionExpression") ||
      isNodeOfType(lastArgument, "FunctionExpression")) &&
    lastArgument.body
  ) {
    return lastArgument.body;
  }
  return null;
};

// Walks a chained method-call expression (Hono / Elysia / itty-router style)
// such as `new Hono().use(...).get("/", cb)` and returns every callback body
// passed to `.get(<pathLike>, <fn>)` on that chain. Requires the first arg
// to be string-like so we don't mistake `Map.get(key)` or `prisma.user.get`
// for a route handler.
export const collectChainedGetHandlerBodies = (initNode: EsTreeNode): EsTreeNode[] => {
  const bodies: EsTreeNode[] = [];
  let current: EsTreeNode | null | undefined = initNode;
  while (current && isNodeOfType(current, "CallExpression")) {
    if (isGetMethodCall(current)) {
      const body = getHandlerCallbackBody(current);
      if (body) bodies.push(body);
    }
    current = isNodeOfType(current.callee, "MemberExpression") ? current.callee.object : null;
  }
  return bodies;
};
