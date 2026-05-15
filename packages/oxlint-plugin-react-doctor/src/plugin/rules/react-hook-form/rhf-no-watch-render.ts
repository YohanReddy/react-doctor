import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rhfNoWatchRender = defineRule<Rule>({
  id: "rhf-no-watch-render",
  severity: "warn",
  recommendation:
    "Use useWatch for render-time React Hook Form subscriptions; watch() in render subscribes broadly and can rerender the whole form",
  create: (context: RuleContext) => {
    let hasReactHookFormImport = false;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (source === "react-hook-form") hasReactHookFormImport = true;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!hasReactHookFormImport) return;
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "watch") return;
        context.report({
          node,
          message:
            "watch() called during render — use useWatch({ control, name }) for a focused subscription",
        });
      },
    };
  },
});
