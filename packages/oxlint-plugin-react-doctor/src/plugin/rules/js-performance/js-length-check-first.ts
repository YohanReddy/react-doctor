import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isEqualityLengthComparison = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BinaryExpression") &&
  (node.operator === "===" || node.operator === "==") &&
  (isMemberProperty(node.left, "length") || isMemberProperty(node.right, "length"));

const isInequalityLengthComparison = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BinaryExpression") &&
  (node.operator === "!==" || node.operator === "!=") &&
  (isMemberProperty(node.left, "length") || isMemberProperty(node.right, "length"));

const isDescendantOf = (node: EsTreeNode, target: EsTreeNode | null | undefined): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === target) return true;
    current = current.parent;
  }
  return false;
};

const isInsideLengthGuard = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      isEqualityLengthComparison(ancestor.left)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "IfStatement")) {
      const isInTrueBranch = isDescendantOf(node, ancestor.consequent);
      const isInFalseBranch = isDescendantOf(node, ancestor.alternate);
      if (isInTrueBranch && isEqualityLengthComparison(ancestor.test)) return true;
      if (isInFalseBranch && isInequalityLengthComparison(ancestor.test)) return true;
    }
    if (isNodeOfType(ancestor, "ConditionalExpression")) {
      const isInTrueBranch = isDescendantOf(node, ancestor.consequent);
      const isInFalseBranch = isDescendantOf(node, ancestor.alternate);
      if (isInTrueBranch && isEqualityLengthComparison(ancestor.test)) return true;
      if (isInFalseBranch && isInequalityLengthComparison(ancestor.test)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isIndexedMemberAccess = (node: EsTreeNode, indexName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === indexName;

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule<Rule>({
  id: "js-length-check-first",
  severity: "warn",
  recommendation:
    "Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      ) {
        return;
      }
      const params = callback.params ?? [];
      if (params.length < 2) return; // need (item, index, ...) to address other array

      const indexParam = params[1];
      if (!isNodeOfType(indexParam, "Identifier")) return;

      let hasElementWiseComparison = false;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (hasElementWiseComparison) return;
        if (
          !isNodeOfType(child, "BinaryExpression") ||
          (child.operator !== "===" && child.operator !== "!==")
        ) {
          return;
        }
        if (
          isIndexedMemberAccess(child.left, indexParam.name) ||
          isIndexedMemberAccess(child.right, indexParam.name)
        ) {
          hasElementWiseComparison = true;
        }
      });

      if (!hasElementWiseComparison) return;
      if (isInsideLengthGuard(node)) return;

      context.report({
        node,
        message:
          ".every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately",
      });
    },
  }),
});
