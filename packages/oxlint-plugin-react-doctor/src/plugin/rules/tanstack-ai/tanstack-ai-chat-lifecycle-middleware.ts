import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getLocalName } from "../../utils/get-local-name.js";
import { getNamespaceImportName } from "../../utils/get-namespace-import-name.js";
import { getPropertyName } from "../../utils/get-property-name.js";
import { isIdentifierCall } from "../../utils/is-identifier-call.js";
import { isNamespaceCall } from "../../utils/is-namespace-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const CHAT_LIFECYCLE_CALLBACKS = new Set([
  "onAbort",
  "onAfterToolCall",
  "onBeforeToolCall",
  "onChunk",
  "onEnd",
  "onError",
  "onFinish",
  "onStart",
  "onUsage",
]);

export const tanstackAiChatLifecycleMiddleware = defineRule<Rule>({
  id: "tanstack-ai-chat-lifecycle-middleware",
  severity: "warn",
  recommendation:
    "Put TanStack AI chat lifecycle hooks inside the middleware array so terminal events, tool hooks, usage, and errors run through the supported middleware pipeline",
  create: (context: RuleContext) => {
    const chatNames = new Set<string>();
    const tanstackAiNamespaces = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (getImportSourceValue(node) !== "@tanstack/ai") return;
        for (const specifier of node.specifiers ?? []) {
          const namespaceName = getNamespaceImportName(specifier);
          if (namespaceName) tanstackAiNamespaces.add(namespaceName);
          if (getImportedName(specifier) !== "chat") continue;
          const localName = getLocalName(specifier);
          if (localName) chatNames.add(localName);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isIdentifierCall(node, chatNames) &&
          !isNamespaceCall(node, tanstackAiNamespaces, "chat")
        ) {
          return;
        }
        const options = node.arguments?.[0];
        if (!isNodeOfType(options, "ObjectExpression")) return;
        for (const property of options.properties ?? []) {
          const propertyName = getPropertyName(property);
          if (!propertyName || !CHAT_LIFECYCLE_CALLBACKS.has(propertyName)) continue;
          context.report({
            node: property,
            message: `chat() lifecycle callback "${propertyName}" should be inside middleware: [{ ${propertyName}: ... }]`,
          });
        }
      },
    };
  },
});
