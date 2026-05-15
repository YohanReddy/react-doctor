import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getJsxName } from "../../utils/get-jsx-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasTruthyAsChild = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const asChild = findJsxAttribute(openingElement.attributes ?? [], "asChild");
  if (!asChild) return false;
  if (!asChild.value) return true;
  if (isNodeOfType(asChild.value, "Literal")) return asChild.value.value !== false;
  if (!isNodeOfType(asChild.value, "JSXExpressionContainer")) return true;
  const expression = asChild.value.expression;
  if (isNodeOfType(expression, "Literal")) return expression.value !== false;
  return Boolean(expression);
};

const isJsxComment = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXExpressionContainer") &&
  isNodeOfType(node.expression, "JSXEmptyExpression");

const getMeaningfulJsxChildren = (node: EsTreeNodeOfType<"JSXElement">): EsTreeNode[] =>
  (node.children ?? []).filter((child: EsTreeNode) => {
    if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
    if (isJsxComment(child)) return false;
    return true;
  });

export const radixAschildSingleChild = defineRule<Rule>({
  id: "radix-aschild-single-child",
  severity: "error",
  recommendation:
    "Radix asChild must receive exactly one element child that can accept props and refs; wrap multiple children in a single component that forwards props",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (!hasTruthyAsChild(openingElement)) return;
      const meaningfulChildren = getMeaningfulJsxChildren(node);
      if (meaningfulChildren.length === 1) {
        const onlyChild = meaningfulChildren[0];
        if (
          isNodeOfType(onlyChild, "JSXElement") ||
          isNodeOfType(onlyChild, "JSXExpressionContainer")
        ) {
          return;
        }
      }
      const elementName = getJsxName(openingElement.name) ?? "component";
      context.report({
        node: openingElement,
        message: `${elementName} uses asChild but does not have exactly one element child — Radix can only clone a single prop-forwarding child`,
      });
    },
  }),
});
