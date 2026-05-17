import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getJsxElementName } from "../../utils/get-jsx-element-name.js";
import { findJsxAttributeIgnoreCase } from "../../utils/find-jsx-attribute-ignore-case.js";
import { hasSpreadAttribute } from "../../utils/jsx-a11y-helpers.js";

const NO_HREF_MESSAGE =
  "The `href` attribute is required for an anchor to be keyboard accessible. Provide a valid, navigable address as the `href` value. If you cannot provide an `href`, but still need the element to resemble a link, use a `<button>` and change it with appropriate styles.";
const INVALID_HREF_MESSAGE =
  "The `href` attribute requires a valid value to be accessible. Provide a valid, navigable address as the `href` value. If you cannot provide a valid `href`, but still need the element to resemble a link, use a `<button>` and change it with appropriate styles.";

const INVALID_HREF_VALUES = new Set(["#", "javascript:void(0)", "javascript:void(0);"]);

const isInvalidHrefValue = (value: string): boolean =>
  INVALID_HREF_VALUES.has(value) || value.startsWith("javascript:");

export const a11yAnchorIsValid = defineRule<Rule>({
  id: "a11y-anchor-is-valid",
  severity: "warn",
  recommendation: NO_HREF_MESSAGE,
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getJsxElementName(node);
      if (tagName !== "a") return;
      if (hasSpreadAttribute(node.attributes)) return;
      const hrefAttribute = findJsxAttributeIgnoreCase(node.attributes, "href");
      if (!hrefAttribute) {
        context.report({ node, message: NO_HREF_MESSAGE });
        return;
      }
      if (!hrefAttribute.value) return;
      if (isNodeOfType(hrefAttribute.value, "JSXExpressionContainer")) {
        const expression = hrefAttribute.value.expression;
        if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") {
          context.report({ node, message: INVALID_HREF_MESSAGE });
          return;
        }
        if (isNodeOfType(expression, "Literal") && expression.value === null) {
          context.report({ node, message: INVALID_HREF_MESSAGE });
          return;
        }
        if (
          isNodeOfType(expression, "Literal") &&
          typeof expression.value === "string" &&
          isInvalidHrefValue(expression.value)
        ) {
          context.report({ node, message: INVALID_HREF_MESSAGE });
          return;
        }
      }
      if (
        isNodeOfType(hrefAttribute.value, "Literal") &&
        typeof hrefAttribute.value.value === "string"
      ) {
        if (isInvalidHrefValue(hrefAttribute.value.value)) {
          context.report({ node, message: INVALID_HREF_MESSAGE });
        }
      }
    },
  }),
});
