import { defineRule } from "../../registry.js";
import { CHAINABLE_ITERATION_METHODS, isNodeOfType } from "./utils/index.js";
import type { EsTreeNode, Rule, RuleContext } from "./utils/index.js";

const ITERATOR_SOURCE_METHOD_NAMES = new Set(["entries", "keys", "values"]);

const isIteratorFromCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "Iterator" &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "from";

const isIteratorHelperChain = (node: EsTreeNode): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (isIteratorFromCall(currentNode)) return true;
    if (!isNodeOfType(currentNode, "CallExpression")) return false;
    const callee: EsTreeNode = currentNode.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    if (
      isNodeOfType(callee.property, "Identifier") &&
      ITERATOR_SOURCE_METHOD_NAMES.has(callee.property.name)
    ) {
      return true;
    }
    currentNode = callee.object;
  }
  return false;
};

export const jsCombineIterations = defineRule<Rule>({
  recommendation:
    "Combine chained array passes when they traverse the same data and the intermediate arrays are not needed.",
  examples: [
    {
      before: `const active = users.filter(isActive);
const names = active.map(getName);`,
      after: `const names = users.flatMap((user) => isActive(user) ? [getName(user)] : []);`,
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !isNodeOfType(node.callee.property, "Identifier")
      )
        return;

      const outerMethod = node.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

      const innerCall = node.callee.object;
      if (
        !isNodeOfType(innerCall, "CallExpression") ||
        !isNodeOfType(innerCall.callee, "MemberExpression") ||
        !isNodeOfType(innerCall.callee.property, "Identifier")
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;
      if (isIteratorHelperChain(innerCall.callee.object)) return;

      if (innerMethod === "map" && outerMethod === "filter") {
        const filterArgument = node.arguments?.[0];
        const isBooleanOrIdentityFilter =
          (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
          (isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
            filterArgument.params?.length === 1 &&
            isNodeOfType(filterArgument.body, "Identifier") &&
            isNodeOfType(filterArgument.params[0], "Identifier") &&
            filterArgument.body.name === filterArgument.params[0].name);
        if (isBooleanOrIdentityFilter) return;
      }

      context.report({
        node,
        message: `.${innerMethod}().${outerMethod}() iterates the array twice - combine into a single loop with .reduce() or for...of`,
      });
    },
  }),
});
