import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const THREE_ALLOCATING_CONSTRUCTORS = new Set([
  "Box3",
  "Color",
  "Euler",
  "Matrix3",
  "Matrix4",
  "Quaternion",
  "Raycaster",
  "Vector2",
  "Vector3",
  "Vector4",
]);

export const r3fNoNewInFrame = defineRule<Rule>({
  id: "r3f-no-new-in-frame",
  severity: "error",
  recommendation:
    "Do not allocate Three.js objects inside useFrame; reuse refs or module-scope scratch objects so the render loop does not create garbage every frame",
  create: (context: RuleContext) => {
    let frameDepth = 0;

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isHookCall(node, "useFrame")) frameDepth++;
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isHookCall(node, "useFrame")) frameDepth = Math.max(0, frameDepth - 1);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (frameDepth === 0) return;
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!THREE_ALLOCATING_CONSTRUCTORS.has(node.callee.name)) return;
        context.report({
          node,
          message: `new ${node.callee.name}() inside useFrame allocates every frame — reuse a scratch object or ref`,
        });
      },
    };
  },
});
