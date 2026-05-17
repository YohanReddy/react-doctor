import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxElementName } from "../../utils/get-jsx-element-name.js";
import { findJsxAttributeIgnoreCase } from "../../utils/find-jsx-attribute-ignore-case.js";
import {
  HTML_TAGS,
  isHiddenFromScreenReader,
  isPresentationRole,
  isInteractiveElement,
  hasSpreadAttribute,
  getJsxAttributeStringValue,
  INTERACTIVE_ROLES,
} from "../../utils/jsx-a11y-helpers.js";

const EVENT_HANDLER_PROPS = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyPress",
  "onKeyDown",
  "onKeyUp",
  "onDblClick",
  "onContextMenu",
  "onDrag",
  "onDragEnd",
  "onDragEnter",
  "onDragExit",
  "onDragLeave",
  "onDragOver",
  "onDragStart",
  "onDrop",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseMove",
  "onMouseOut",
  "onMouseOver",
];

const MESSAGE =
  "Static HTML elements with event handlers require a role. Add a `role` attribute to the element.";

export const a11yNoStaticElementInteractions = defineRule<Rule>({
  id: "a11y-no-static-element-interactions",
  severity: "warn",
  recommendation: MESSAGE,
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getJsxElementName(node);
      if (!HTML_TAGS.has(tagName)) return;
      if (hasSpreadAttribute(node.attributes)) return;
      if (isInteractiveElement(tagName, node.attributes)) return;
      if (isHiddenFromScreenReader(node.attributes)) return;
      if (isPresentationRole(node.attributes)) return;

      const roleAttribute = findJsxAttributeIgnoreCase(node.attributes, "role");
      if (roleAttribute) {
        const roleValue = getJsxAttributeStringValue(roleAttribute);
        if (roleValue && INTERACTIVE_ROLES.has(roleValue)) return;
      }

      const hasEventHandler = EVENT_HANDLER_PROPS.some((prop) =>
        Boolean(findJsxAttributeIgnoreCase(node.attributes, prop)),
      );
      if (!hasEventHandler) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
