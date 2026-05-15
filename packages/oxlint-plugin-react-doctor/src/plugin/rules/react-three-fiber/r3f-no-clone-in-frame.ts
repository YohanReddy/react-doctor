import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const r3fNoCloneInFrame = defineRule<Rule>({
  id: "r3f-no-clone-in-frame",
  severity: "error",
  recommendation:
    "Do not call .clone() inside useFrame; clone allocates every frame, so copy into a reused object instead",
  create: (context: RuleContext) => {
    let frameDepth = 0;

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, "useFrame")) {
          frameDepth++;
          return;
        }
        if (frameDepth === 0) return;
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (
          !isNodeOfType(node.callee.property, "Identifier") ||
          node.callee.property.name !== "clone"
        ) {
          return;
        }
        context.report({
          node,
          message:
            ".clone() inside useFrame allocates every frame — copy into a reused vector/object instead",
        });
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isHookCall(node, "useFrame")) frameDepth = Math.max(0, frameDepth - 1);
      },
    };
  },
});
