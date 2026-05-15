import { USER_EVENT_METHODS } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { getMemberPropertyName } from "../../utils/get-member-property-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const testingAwaitUserEvent = defineRule<Rule>({
  id: "testing-await-user-event",
  severity: "error",
  recommendation:
    "Await async userEvent interactions so assertions run after the browser-like event sequence has finished",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getRootIdentifierName(node.callee) !== "userEvent") return;
      const methodName = getMemberPropertyName(node.callee);
      if (!methodName || !USER_EVENT_METHODS.has(methodName)) return;
      if (isNodeOfType(node.parent, "AwaitExpression")) return;
      context.report({
        node,
        message: `userEvent.${methodName}() is async — await it before asserting`,
      });
    },
  }),
});
