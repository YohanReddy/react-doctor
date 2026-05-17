import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const hasKeyProp = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXOpeningElement")) {
    return node.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "key",
    );
  }
  return false;
};

const isInsideArrayOrIterator = (node: EsTreeNode): "array" | "iterator" | null => {
  const parent = node.parent;
  if (!parent) return null;

  if (isNodeOfType(parent, "ArrayExpression")) return "array";

  if (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) return null;

  if (isNodeOfType(parent, "ConditionalExpression")) {
    return isInsideArrayOrIterator(parent);
  }

  if (isNodeOfType(parent, "LogicalExpression")) {
    return isInsideArrayOrIterator(parent);
  }

  if (isNodeOfType(parent, "ReturnStatement")) {
    const functionParent = parent.parent;
    if (!functionParent) return null;
    return checkIfCallbackInIterator(functionParent);
  }

  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === node) {
    return checkIfCallbackInIterator(parent);
  }

  if (isNodeOfType(parent, "ExpressionStatement")) {
    return isInsideArrayOrIterator(parent);
  }

  if (isNodeOfType(parent, "BlockStatement")) {
    return checkIfCallbackInIterator(parent);
  }

  return null;
};

const checkIfCallbackInIterator = (node: EsTreeNode): "iterator" | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression")
    ) {
      const callParent = current.parent;
      if (callParent && isNodeOfType(callParent, "CallExpression")) {
        if (isIteratorCall(callParent)) return "iterator";
      }
      return null;
    }
    if (isNodeOfType(current, "BlockStatement")) {
      current = current.parent;
      continue;
    }
    if (isNodeOfType(current, "ReturnStatement") || isNodeOfType(current, "IfStatement")) {
      current = current.parent;
      continue;
    }
    return null;
  }
  return null;
};

const isIteratorCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;

  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    if (callee.property.name === "map" || callee.property.name === "flatMap") return true;
  }

  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    if (callee.property.name === "from") {
      if (isNodeOfType(callee.object, "Identifier") && callee.object.name === "Array") return true;
    }
  }

  return false;
};

const isChildrenToArray = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "toArray"
  ) {
    if (
      isNodeOfType(callee.object, "MemberExpression") &&
      isNodeOfType(callee.object.property, "Identifier") &&
      callee.object.property.name === "Children"
    )
      return true;
    if (isNodeOfType(callee.object, "Identifier") && callee.object.name === "Children") return true;
  }
  return false;
};

const isWithinChildrenToArray = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isChildrenToArray(current)) return true;
    current = current.parent;
  }
  return false;
};

export const jsxKey = defineRule<Rule>({
  id: "jsx-key",
  severity: "error",
  recommendation:
    "Add a unique `key` prop to each element rendered in a list or iterator to help React identify which items changed",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (isWithinChildrenToArray(node)) return;
      const location = isInsideArrayOrIterator(node);
      if (!location) return;
      if (hasKeyProp(node.openingElement)) return;
      const message =
        location === "array"
          ? 'Missing "key" prop for element in array — add a unique key to avoid rendering issues'
          : 'Missing "key" prop for element in iterator — add a unique key to each element returned from .map() or Array.from()';
      context.report({ node, message });
    },
    JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
      if (isWithinChildrenToArray(node)) return;
      const location = isInsideArrayOrIterator(node);
      if (!location) return;
      const message =
        location === "array"
          ? 'Missing "key" prop for fragment in array — use <Fragment key={...}> instead of shorthand <></>'
          : 'Missing "key" prop for fragment in iterator — use <Fragment key={...}> instead of shorthand <></>';
      context.report({ node, message });
    },
  }),
});
