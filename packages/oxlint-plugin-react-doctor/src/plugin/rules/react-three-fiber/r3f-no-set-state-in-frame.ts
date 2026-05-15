import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const r3fNoSetStateInFrame = defineRule<Rule>({
  id: "r3f-no-set-state-in-frame",
  severity: "error",
  recommendation:
    "Do not call React state setters inside useFrame; put per-frame values in refs or external stores so the render loop does not force React renders",
  create: (context: RuleContext) => {
    let frameDepth = 0;

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, "useFrame")) {
          frameDepth++;
          return;
        }
        if (frameDepth === 0 || !isSetterCall(node)) return;
        context.report({
          node,
          message:
            "React state update inside useFrame forces React work at frame rate — use a ref or external store for frame data",
        });
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isHookCall(node, "useFrame")) frameDepth = Math.max(0, frameDepth - 1);
      },
    };
  },
});
