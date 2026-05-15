import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getLocalName } from "../../utils/get-local-name.js";
import { getNamespaceImportName } from "../../utils/get-namespace-import-name.js";
import { isIdentifierCall } from "../../utils/is-identifier-call.js";
import { isNamespaceCall } from "../../utils/is-namespace-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackAiNoManualSseResponse = defineRule<Rule>({
  id: "tanstack-ai-no-manual-sse-response",
  severity: "warn",
  recommendation:
    "Return toServerSentEventsResponse(stream) for TanStack AI SSE endpoints so headers, done markers, abort behavior, and error events stay consistent",
  create: (context: RuleContext) => {
    const sseStreamNames = new Set<string>();
    const sseStreamBindings = new Set<string>();
    const tanstackAiNamespaces = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (getImportSourceValue(node) !== "@tanstack/ai") return;
        for (const specifier of node.specifiers ?? []) {
          const namespaceName = getNamespaceImportName(specifier);
          if (namespaceName) tanstackAiNamespaces.add(namespaceName);
          if (getImportedName(specifier) !== "toServerSentEventsStream") continue;
          const localName = getLocalName(specifier);
          if (localName) sseStreamNames.add(localName);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (
          !isIdentifierCall(node.init, sseStreamNames) &&
          !isNamespaceCall(node.init, tanstackAiNamespaces, "toServerSentEventsStream")
        ) {
          return;
        }
        sseStreamBindings.add(node.id.name);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "Response") return;
        const body = node.arguments?.[0];
        const wrapsSseStreamCall =
          isIdentifierCall(body, sseStreamNames) ||
          isNamespaceCall(body, tanstackAiNamespaces, "toServerSentEventsStream");
        const wrapsSseStreamBinding =
          isNodeOfType(body, "Identifier") && sseStreamBindings.has(body.name);
        if (!wrapsSseStreamCall && !wrapsSseStreamBinding) return;
        context.report({
          node,
          message:
            "manual Response around toServerSentEventsStream — return toServerSentEventsResponse(stream) so TanStack AI owns SSE headers, completion, and errors",
        });
      },
    };
  },
});
