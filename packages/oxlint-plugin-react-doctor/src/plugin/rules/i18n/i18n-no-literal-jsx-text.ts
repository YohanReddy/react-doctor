import { defineRule } from "../../utils/define-rule.js";
import { getJsxName } from "../../utils/get-jsx-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_USER_TEXT_ELEMENTS = new Set(["code", "kbd", "pre", "script", "style", "textarea"]);
const TRANSLATION_COMPONENT_NAMES = new Set(["FormattedMessage", "I18n", "Trans", "Translate"]);

const hasLetters = (value: string): boolean => /[A-Za-z]/.test(value);

const isInsideIgnoredTextElement = (node: EsTreeNode): boolean => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "JSXElement")) {
      const elementName = getJsxName(currentNode.openingElement?.name);
      if (elementName && TRANSLATION_COMPONENT_NAMES.has(elementName)) return true;
      if (elementName && NON_USER_TEXT_ELEMENTS.has(elementName)) return true;
    }
    currentNode = currentNode.parent;
  }
  return false;
};

export const i18nNoLiteralJsxText = defineRule<Rule>({
  id: "i18n-no-literal-jsx-text",
  severity: "warn",
  recommendation: "Move user-facing JSX copy through the project translation layer",
  create: (context: RuleContext) => ({
    JSXText(node: EsTreeNodeOfType<"JSXText">) {
      const text = typeof node.value === "string" ? node.value.trim() : "";
      if (!text || !hasLetters(text)) return;
      if (isInsideIgnoredTextElement(node)) return;
      context.report({
        node,
        message: `literal JSX text "${text}" is user-facing copy — read it from the translation layer`,
      });
    },
  }),
});
