import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findDownstreamNodes, getDownstreamRefs, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectFnRefs, hasCleanup, isProp, isState, isUseEffect } from "./utils/effect/react.js";

// 1:1 port of upstream `src/rules/no-event-handler.js`.

export const noEventHandler = defineRule<Rule>({
  id: "no-event-handler",
  severity: "warn",
  recommendation:
    "Move the side effect into the event handler that triggers it, instead of guarding on its state inside a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;

      const ifStatementsNoElse = findDownstreamNodes(node, "IfStatement").filter(
        (ifNode) => isNodeOfType(ifNode, "IfStatement") && !ifNode.alternate,
      );
      const ifTestRefs = ifStatementsNoElse.flatMap((ifNode) => {
        if (!isNodeOfType(ifNode, "IfStatement")) return [];
        return getDownstreamRefs(analysis, ifNode.test as EsTreeNode).flatMap((ref) =>
          getUpstreamRefs(analysis, ref),
        );
      });

      for (const ref of ifTestRefs) {
        if (isState(analysis, ref)) {
          context.report({
            node: ref.identifier as unknown as EsTreeNode,
            message:
              "Avoid using state and effects as an event handler. Instead, call the event handling code directly when the event occurs.",
          });
        }
      }
      for (const ref of ifTestRefs) {
        if (isProp(analysis, ref)) {
          context.report({
            node: ref.identifier as unknown as EsTreeNode,
            message:
              "Avoid using props and effects as an event handler. Instead, move the handler to the parent component.",
          });
        }
      }
    },
  }),
});
