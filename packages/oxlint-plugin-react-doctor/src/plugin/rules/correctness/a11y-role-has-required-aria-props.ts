import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxElementName } from "../../utils/get-jsx-element-name.js";
import { findJsxAttributeIgnoreCase } from "../../utils/find-jsx-attribute-ignore-case.js";
import {
  getJsxAttributeStringValue,
  hasSpreadAttribute,
  ABSTRACT_ROLES,
  ELEMENT_IMPLICIT_ROLES,
} from "../../utils/jsx-a11y-helpers.js";

const ROLE_REQUIRED_ARIA_PROPS: Record<string, string[]> = {
  checkbox: ["aria-checked"],
  combobox: ["aria-controls", "aria-expanded"],
  heading: ["aria-level"],
  meter: ["aria-valuenow"],
  menuitemcheckbox: ["aria-checked"],
  menuitemradio: ["aria-checked"],
  option: ["aria-selected"],
  radio: ["aria-checked"],
  scrollbar: ["aria-controls", "aria-valuenow"],
  separator: ["aria-valuenow"],
  slider: ["aria-valuenow"],
  switch: ["aria-checked"],
};

const MESSAGE = "Elements with ARIA roles must have all required ARIA attributes defined.";

export const a11yRoleHasRequiredAriaProps = defineRule<Rule>({
  id: "a11y-role-has-required-aria-props",
  severity: "error",
  recommendation: MESSAGE,
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getJsxElementName(node);
      if (hasSpreadAttribute(node.attributes)) return;
      const roleAttribute = findJsxAttributeIgnoreCase(node.attributes, "role");
      if (!roleAttribute) return;
      const roleValue = getJsxAttributeStringValue(roleAttribute);
      if (!roleValue) return;
      if (ABSTRACT_ROLES.has(roleValue)) return;

      const implicitRoles = ELEMENT_IMPLICIT_ROLES[tagName];
      if (implicitRoles?.includes(roleValue)) return;

      const requiredProps = ROLE_REQUIRED_ARIA_PROPS[roleValue];
      if (!requiredProps) return;

      const missingProps = requiredProps.filter(
        (prop) => !findJsxAttributeIgnoreCase(node.attributes, prop),
      );

      if (missingProps.length > 0) {
        context.report({
          node,
          message: `Elements with the ARIA role \`${roleValue}\` must have the following attributes defined: ${missingProps.map((prop) => `\`${prop}\``).join(", ")}.`,
        });
      }
    },
  }),
});
