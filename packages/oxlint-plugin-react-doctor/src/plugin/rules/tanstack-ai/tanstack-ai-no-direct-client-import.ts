import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackAiNoDirectClientImport = defineRule<Rule>({
  id: "tanstack-ai-no-direct-client-import",
  severity: "warn",
  recommendation:
    "Import client hooks from the framework package such as @tanstack/ai-react; only vanilla JavaScript should import @tanstack/ai-client directly",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (getImportSourceValue(node) !== "@tanstack/ai-client") return;
      context.report({
        node,
        message:
          "direct @tanstack/ai-client import bypasses framework integration — use @tanstack/ai-react, @tanstack/ai-solid, or the matching framework package",
      });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return;
      const source = node.arguments?.[0];
      if (!isNodeOfType(source, "Literal") || source.value !== "@tanstack/ai-client") return;
      context.report({
        node,
        message:
          "direct @tanstack/ai-client require bypasses framework integration — use the matching TanStack AI framework package",
      });
    },
  }),
});
