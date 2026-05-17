import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Best-effort parse a JSX attribute value to a number. Mirrors
// oxc_linter::utils::react::parse_jsx_value. Returns null when the
// value isn't a static numeric literal or string.
export const parseJsxValue = (value: EsTreeNode | null | undefined): number | null => {
  if (!value) return null;
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value === "number") return value.value;
    if (typeof value.value === "string") {
      const parsed = Number(value.value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "number") return expression.value;
      if (typeof expression.value === "string") {
        const parsed = Number(expression.value);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    if (
      isNodeOfType(expression, "UnaryExpression") &&
      expression.operator === "-" &&
      isNodeOfType(expression.argument, "Literal") &&
      typeof expression.argument.value === "number"
    ) {
      return -expression.argument.value;
    }
    if (
      isNodeOfType(expression, "TemplateLiteral") &&
      expression.expressions.length === 0 &&
      expression.quasis.length === 1
    ) {
      const cooked = expression.quasis[0]!.value.cooked ?? "";
      const parsed = Number(cooked);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      const wrap = (innerExpression: EsTreeNode): EsTreeNode =>
        ({
          ...({ type: "JSXExpressionContainer", expression: innerExpression } as unknown as Record<
            string,
            unknown
          >),
        }) as EsTreeNode;
      if (isNodeOfType(expression.test, "Literal")) {
        return parseJsxValue(
          wrap(
            (expression.test.value ? expression.consequent : expression.alternate) as EsTreeNode,
          ),
        );
      }
      return parseJsxValue(wrap(expression.consequent as EsTreeNode));
    }
  }
  return null;
};
