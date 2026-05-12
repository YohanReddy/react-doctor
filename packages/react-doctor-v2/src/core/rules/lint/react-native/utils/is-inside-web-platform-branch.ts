import { isNodeOfType } from "../../utils/index.js";
import type { EsTreeNode } from "../../utils/index.js";

const WEB_PLATFORM_NAME = "web";

const getStaticStringValue = (node: EsTreeNode | null | undefined): string | null =>
  (node?.type === "Literal" || node?.type === "StringLiteral") && typeof node.value === "string"
    ? node.value
    : null;

const isPlatformOsExpression = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === "Platform" &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "OS";

const isWebPlatformComparison = (
  node: EsTreeNode | null | undefined,
  expectedResult: boolean,
): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (
    node.operator !== "===" &&
    node.operator !== "==" &&
    node.operator !== "!==" &&
    node.operator !== "!="
  ) {
    return false;
  }
  const comparesWebPlatform =
    (isPlatformOsExpression(node.left) && getStaticStringValue(node.right) === WEB_PLATFORM_NAME) ||
    (isPlatformOsExpression(node.right) && getStaticStringValue(node.left) === WEB_PLATFORM_NAME);
  if (!comparesWebPlatform) return false;
  const operatorResult = node.operator === "===" || node.operator === "==";
  return operatorResult === expectedResult;
};

const isSameOrDescendant = (node: EsTreeNode, ancestor: EsTreeNode | null | undefined): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (currentNode === ancestor) return true;
    currentNode = currentNode.parent;
  }
  return false;
};

export const isInsideWebPlatformBranch = (node: EsTreeNode): boolean => {
  let currentNode: EsTreeNode | null | undefined = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "IfStatement")) {
      if (
        isSameOrDescendant(node, currentNode.consequent) &&
        isWebPlatformComparison(currentNode.test, true)
      ) {
        return true;
      }
      if (
        isSameOrDescendant(node, currentNode.alternate) &&
        isWebPlatformComparison(currentNode.test, false)
      ) {
        return true;
      }
    }
    if (isNodeOfType(currentNode, "ConditionalExpression")) {
      if (
        isSameOrDescendant(node, currentNode.consequent) &&
        isWebPlatformComparison(currentNode.test, true)
      ) {
        return true;
      }
      if (
        isSameOrDescendant(node, currentNode.alternate) &&
        isWebPlatformComparison(currentNode.test, false)
      ) {
        return true;
      }
    }
    if (isNodeOfType(currentNode, "LogicalExpression")) {
      if (
        currentNode.operator === "&&" &&
        isSameOrDescendant(node, currentNode.right) &&
        isWebPlatformComparison(currentNode.left, true)
      ) {
        return true;
      }
      if (
        currentNode.operator === "||" &&
        isSameOrDescendant(node, currentNode.right) &&
        isWebPlatformComparison(currentNode.left, false)
      ) {
        return true;
      }
    }
    currentNode = currentNode.parent;
  }
  return false;
};
