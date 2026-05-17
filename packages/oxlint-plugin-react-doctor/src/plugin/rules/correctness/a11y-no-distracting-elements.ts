import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxElementName } from "../../utils/get-jsx-element-name.js";

const DISTRACTING_ELEMENTS = new Set(["marquee", "blink"]);

const MESSAGE =
  "Do not use distracting elements like `<marquee>` or `<blink>` as they can create visual accessibility issues and are deprecated.";

export const a11yNoDistractingElements = defineRule<Rule>({
  id: "a11y-no-distracting-elements",
  severity: "error",
  recommendation: MESSAGE,
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = getJsxElementName(node);
      if (!DISTRACTING_ELEMENTS.has(tagName)) return;
      context.report({
        node,
        message: `Do not use \`<${tagName}>\` elements as they can create visual accessibility issues and are deprecated. Replace with alternative, more accessible ways to achieve the desired visual effects.`,
      });
    },
  }),
});
