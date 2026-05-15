import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SWR_HOOK_NAMES = new Set(["useSWR", "useSWRImmutable", "useSWRInfinite"]);

const isEmptyString = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === "";

export const swrNoEmptyKey = defineRule<Rule>({
  id: "swr-no-empty-key",
  severity: "warn",
  recommendation:
    "Use null to disable SWR requests; an empty string key is an ambiguous cache key and hides the condition that controls fetching",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
      if (!calleeName || !SWR_HOOK_NAMES.has(calleeName)) return;
      const keyArgument = node.arguments?.[0];
      const hasEmptyKey =
        isEmptyString(keyArgument) ||
        (isNodeOfType(keyArgument, "ConditionalExpression") &&
          (isEmptyString(keyArgument.consequent) || isEmptyString(keyArgument.alternate)));
      if (!hasEmptyKey) return;
      context.report({
        node: keyArgument ?? node,
        message:
          "SWR key uses an empty string to disable fetching — use null so the disabled state is explicit",
      });
    },
  }),
});
