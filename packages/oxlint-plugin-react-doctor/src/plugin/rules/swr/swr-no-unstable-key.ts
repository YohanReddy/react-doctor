import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SWR_HOOK_NAMES = new Set(["useSWR", "useSWRImmutable", "useSWRInfinite"]);

const containsUnstableSWRKeyValue = (node: EsTreeNode | undefined): string | null => {
  if (!node) return null;
  let unstableSource: string | null = null;
  walkAst(node, (child) => {
    if (unstableSource) return false;
    if (
      isNodeOfType(child, "NewExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === "Date"
    ) {
      unstableSource = "new Date()";
      return false;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.object, "Identifier") &&
      isNodeOfType(child.callee.property, "Identifier")
    ) {
      const receiverName = child.callee.object.name;
      const methodName = child.callee.property.name;
      if (receiverName === "Date" && methodName === "now") unstableSource = "Date.now()";
      if (receiverName === "Math" && methodName === "random") unstableSource = "Math.random()";
      if (unstableSource) return false;
    }
  });
  return unstableSource;
};

export const swrNoUnstableKey = defineRule<Rule>({
  id: "swr-no-unstable-key",
  severity: "error",
  recommendation:
    "Keep SWR keys deterministic; include stable request inputs and never use time or random values in cache keys",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
      if (!calleeName || !SWR_HOOK_NAMES.has(calleeName)) return;
      const unstableSource = containsUnstableSWRKeyValue(node.arguments?.[0]);
      if (!unstableSource) return;
      context.report({
        node: node.arguments?.[0] ?? node,
        message: `SWR key contains ${unstableSource} — use stable key parts so deduping and cache identity work`,
      });
    },
  }),
});
