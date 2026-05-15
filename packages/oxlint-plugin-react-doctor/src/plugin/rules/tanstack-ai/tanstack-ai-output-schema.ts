import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getLocalName } from "../../utils/get-local-name.js";
import { getNamespaceImportName } from "../../utils/get-namespace-import-name.js";
import { getObjectProperty } from "../../utils/get-object-property.js";
import { getPropertyName } from "../../utils/get-property-name.js";
import { isIdentifierCall } from "../../utils/is-identifier-call.js";
import { isNamespaceCall } from "../../utils/is-namespace-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackAiOutputSchema = defineRule<Rule>({
  id: "tanstack-ai-output-schema",
  severity: "warn",
  recommendation:
    "Use chat({ outputSchema }) with the project's schema library; do not hand-wire provider-specific responseFormat or pass raw JSON Schema objects",
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

        const outputSchema = getObjectProperty(options, "outputSchema");
        if (
          outputSchema &&
          isNodeOfType(outputSchema, "Property") &&
          isNodeOfType(outputSchema.value, "ObjectExpression")
        ) {
          context.report({
            node: outputSchema,
            message:
              "raw object passed to outputSchema — use a runtime schema library such as Zod, ArkType, or Valibot for validation and inference",
          });
        }

        const modelOptions = getObjectProperty(options, "modelOptions");
        if (
          !modelOptions ||
          !isNodeOfType(modelOptions, "Property") ||
          !isNodeOfType(modelOptions.value, "ObjectExpression")
        ) {
          return;
        }
        for (const property of modelOptions.value.properties ?? []) {
          if (getPropertyName(property) !== "responseFormat") continue;
          context.report({
            node: property,
            message:
              "provider-specific responseFormat in modelOptions bypasses TanStack AI structured output handling — pass outputSchema to chat() instead",
          });
        }
      },
    };
  },
});
