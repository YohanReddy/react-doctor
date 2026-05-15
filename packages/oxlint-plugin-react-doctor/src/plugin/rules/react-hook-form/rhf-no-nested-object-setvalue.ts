import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rhfNoNestedObjectSetvalue = defineRule<Rule>({
  id: "rhf-no-nested-object-setvalue",
  severity: "warn",
  recommendation:
    "Call setValue with the exact field path you changed; passing nested objects bypasses React Hook Form's focused dirty/touched tracking",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "setValue") return;
      const fieldName = node.arguments?.[0];
      const valueArgument = node.arguments?.[1];
      if (!isNodeOfType(fieldName, "Literal") || typeof fieldName.value !== "string") return;
      if (fieldName.value.includes(".")) return;
      if (!isNodeOfType(valueArgument, "ObjectExpression")) return;
      context.report({
        node,
        message: `setValue("${fieldName.value}", object) updates a nested object at once — target the exact field path instead`,
      });
    },
  }),
});
