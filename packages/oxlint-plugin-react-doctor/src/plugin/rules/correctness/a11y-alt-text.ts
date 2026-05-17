import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttributeIgnoreCase } from "../../utils/find-jsx-attribute-ignore-case.js";
import { getJsxElementName } from "../../utils/get-jsx-element-name.js";
import {
  getJsxAttributeStringValue,
  hasAccessibleChild,
} from "../../utils/jsx-a11y-helpers.js";

const MISSING_ALT_PROP =
  "Missing `alt` attribute. Must have `alt` prop, either with meaningful text, or an empty string for decorative images.";
const MISSING_ALT_VALUE =
  'Invalid `alt` value. Must have meaningful value for `alt` prop. Use alt="" for presentational images.';
const PREFER_ALT =
  'Prefer alt="" over presentational role. Native HTML attributes should be preferred for accessibility before resorting to ARIA attributes.';
const OBJECT_MESSAGE =
  "Embedded <object> elements must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.";
const AREA_MESSAGE =
  "Each area of an image map must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.";
const INPUT_IMAGE_MESSAGE =
  '<input> elements with type="image" must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.';

const ariaLabelHasValue = (
  attributes: EsTreeNodeOfType<"JSXOpeningElement">["attributes"],
): boolean => {
  const ariaLabel = findJsxAttributeIgnoreCase(attributes, "aria-label");
  if (!ariaLabel) return false;
  if (!ariaLabel.value) return false;
  const stringValue = getJsxAttributeStringValue(ariaLabel);
  if (stringValue !== undefined) return stringValue !== "";
  if (isNodeOfType(ariaLabel.value, "JSXExpressionContainer")) {
    const expression = ariaLabel.value.expression;
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return false;
  }
  return true;
};

const ariaLabelledByHasValue = (
  attributes: EsTreeNodeOfType<"JSXOpeningElement">["attributes"],
): boolean => {
  const ariaLabelledBy = findJsxAttributeIgnoreCase(attributes, "aria-labelledby");
  if (!ariaLabelledBy) return false;
  if (!ariaLabelledBy.value) return false;
  const stringValue = getJsxAttributeStringValue(ariaLabelledBy);
  if (stringValue !== undefined) return stringValue !== "";
  if (isNodeOfType(ariaLabelledBy.value, "JSXExpressionContainer")) {
    const expression = ariaLabelledBy.value.expression;
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return false;
  }
  return true;
};

const isValidAltProp = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return false;
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = attribute.value.expression;
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return false;
    if (
      isNodeOfType(expression, "Literal") &&
      (expression.value === null || expression.value === undefined)
    )
      return false;
  }
  return true;
};

const isPresentationRoleValue = (
  attributes: EsTreeNodeOfType<"JSXOpeningElement">["attributes"],
): boolean => {
  const roleAttribute = findJsxAttributeIgnoreCase(attributes, "role");
  if (!roleAttribute) return false;
  const value = getJsxAttributeStringValue(roleAttribute);
  return value === "presentation" || value === "none";
};

export const a11yAltText = defineRule<Rule>({
  id: "a11y-alt-text",
  severity: "error",
  recommendation: MISSING_ALT_PROP,
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getJsxElementName(node);

      if (tagName === "img") {
        const altProp = findJsxAttributeIgnoreCase(node.attributes, "alt");
        if (altProp) {
          if (!isValidAltProp(altProp)) {
            context.report({ node, message: MISSING_ALT_VALUE });
          }
          return;
        }
        if (isPresentationRoleValue(node.attributes)) {
          context.report({ node, message: PREFER_ALT });
          return;
        }
        if (ariaLabelHasValue(node.attributes) || ariaLabelledByHasValue(node.attributes)) return;
        context.report({ node, message: MISSING_ALT_PROP });
        return;
      }

      if (tagName === "object") {
        if (ariaLabelHasValue(node.attributes) || ariaLabelledByHasValue(node.attributes)) return;
        const titleAttr = findJsxAttributeIgnoreCase(node.attributes, "title");
        if (titleAttr) {
          const titleValue = getJsxAttributeStringValue(titleAttr);
          if (titleValue && titleValue !== "") return;
        }
        return;
      }

      if (tagName === "area") {
        if (ariaLabelHasValue(node.attributes) || ariaLabelledByHasValue(node.attributes)) return;
        const altProp = findJsxAttributeIgnoreCase(node.attributes, "alt");
        if (!altProp || !isValidAltProp(altProp)) {
          context.report({ node, message: AREA_MESSAGE });
        }
        return;
      }

      if (tagName.toLowerCase() === "input") {
        const typeAttr = findJsxAttributeIgnoreCase(node.attributes, "type");
        if (!typeAttr) return;
        const typeValue = getJsxAttributeStringValue(typeAttr);
        if (typeValue !== "image") return;
        if (ariaLabelHasValue(node.attributes) || ariaLabelledByHasValue(node.attributes)) return;
        const altProp = findJsxAttributeIgnoreCase(node.attributes, "alt");
        if (!altProp || !isValidAltProp(altProp)) {
          context.report({ node, message: INPUT_IMAGE_MESSAGE });
        }
      }
    },
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!node.openingElement) return;
      const tagName = getJsxElementName(node.openingElement);
      if (tagName !== "object") return;
      if (
        ariaLabelHasValue(node.openingElement.attributes) ||
        ariaLabelledByHasValue(node.openingElement.attributes)
      )
        return;
      const titleAttr = findJsxAttributeIgnoreCase(node.openingElement.attributes, "title");
      if (titleAttr) {
        const titleValue = getJsxAttributeStringValue(titleAttr);
        if (titleValue && titleValue !== "") return;
      }
      if (hasAccessibleChild(node.children ?? [])) return;
      context.report({ node, message: OBJECT_MESSAGE });
    },
  }),
});
