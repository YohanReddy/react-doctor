import { TEST_OR_INFRA_FILE_PATTERN } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const UPPERCASE_PATTERN = /^[A-Z]/;

const isAddEventListenerCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;
  return node.callee.property.name === "addEventListener";
};

const isInsideComponentOrHook = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "FunctionDeclaration") &&
      current.id?.name &&
      (UPPERCASE_PATTERN.test(current.id.name) || current.id.name.startsWith("use"))
    ) {
      return true;
    }
    if (
      isNodeOfType(current, "VariableDeclarator") &&
      isNodeOfType(current.id, "Identifier") &&
      (UPPERCASE_PATTERN.test(current.id.name) || current.id.name.startsWith("use"))
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

export const clientEventListeners = defineRule<Rule>({
  id: "client-event-listeners",
  severity: "warn",
  recommendation:
    "Share global window/document listeners through one module-level subscription or a shared hook instead of adding one listener per component instance",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isTestOrInfraFile = TEST_OR_INFRA_FILE_PATTERN.test(filename);

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isTestOrInfraFile) return;
        if (!isAddEventListenerCall(node)) return;
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const eventTarget = node.callee.object;
        if (!isNodeOfType(eventTarget, "Identifier")) return;
        if (eventTarget.name !== "window" && eventTarget.name !== "document") return;
        if (!isInsideComponentOrHook(node)) return;
        context.report({
          node,
          message:
            "global event listener is registered per component instance — share it through a module-level subscription or shared hook so N components don't add N listeners",
        });
      },
    };
  },
});
