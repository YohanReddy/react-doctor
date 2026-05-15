import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getLocalName } from "../../utils/get-local-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const I18N_IMPORT_SOURCES = new Set(["i18next", "next-intl", "react-i18next"]);
const TRANSLATION_FUNCTION_NAMES = new Set(["t", "i18n.t"]);
const TRANSLATION_HOOK_NAMES = new Set(["useTranslations", "useTranslation"]);

const isStaticKey = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";

export const i18nNoDynamicTranslationKey = defineRule<Rule>({
  id: "i18n-no-dynamic-translation-key",
  severity: "warn",
  recommendation:
    "Use literal translation keys so extraction, type generation, and missing-key checks can see every message",
  create: (context: RuleContext) => {
    const translationFunctionNames = new Set(TRANSLATION_FUNCTION_NAMES);
    const translationHookNames = new Set(TRANSLATION_HOOK_NAMES);

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (!I18N_IMPORT_SOURCES.has(getImportSourceValue(node) ?? "")) return;
        for (const specifier of node.specifiers ?? []) {
          const importedName = getImportedName(specifier);
          const localName = getLocalName(specifier);
          if (!localName) continue;
          if (importedName && TRANSLATION_HOOK_NAMES.has(importedName)) {
            translationHookNames.add(localName);
          }
          if (importedName === "t") translationFunctionNames.add(localName);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isNodeOfType(node.init, "CallExpression")) return;
        const calleeName = isNodeOfType(node.init.callee, "Identifier")
          ? node.init.callee.name
          : null;
        if (!calleeName || !translationHookNames.has(calleeName)) return;
        translationFunctionNames.add(node.id.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          !translationFunctionNames.has(node.callee.name)
        ) {
          return;
        }
        if (isStaticKey(node.arguments?.[0])) return;
        context.report({
          node: node.arguments?.[0] ?? node,
          message:
            "translation key is dynamic — use a literal key or an explicit map of possible keys",
        });
      },
    };
  },
});
