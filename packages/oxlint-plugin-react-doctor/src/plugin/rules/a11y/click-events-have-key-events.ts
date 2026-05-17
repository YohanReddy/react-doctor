import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import type { Rule } from "../../utils/rule.js";
import { HTML_TAGS } from "../../constants/html-tags.js";

const PRESENTATION_ROLES: ReadonlySet<string> = new Set(["presentation", "none"]);

const MESSAGE =
  "Visible non-interactive elements with click handlers must have a corresponding keyboard listener (`onKeyUp`, `onKeyDown`, or `onKeyPress`).";

const KEY_HANDLERS = ["onKeyUp", "onKeyDown", "onKeyPress"] as const;

// Port of `oxc_linter::rules::jsx_a11y::click_events_have_key_events`.
// Flags elements with `onClick` that lack a keyboard handler — only
// applies to non-interactive HTML elements (interactive ones already
// support keyboard activation).
export const clickEventsHaveKeyEvents = defineRule<Rule>({
  id: "click-events-have-key-events",
  severity: "warn",
  recommendation: "Pair `onClick` with `onKeyUp` / `onKeyDown` / `onKeyPress` for keyboard users.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      // Skip non-DOM elements (custom components might handle keyboard
      // internally).
      if (!HTML_TAGS.has(tag)) return;
      // Skip interactive elements (button, a[href], etc.) — they
      // already handle keyboard activation.
      if (isInteractiveElement(tag, node)) return;
      // Skip elements with no children visible to users.
      if (!hasJsxPropIgnoreCase(node.attributes, "onClick")) return;

      if (isHiddenFromScreenReader(node, context.settings)) return;

      // Presentational role (presentation / none) → not perceivable
      // by AT, so skip.
      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      if (roleAttribute) {
        const roleValue = getJsxPropStringValue(roleAttribute);
        if (roleValue && PRESENTATION_ROLES.has(roleValue)) return;
      }
      // Has a key handler? OK.
      const hasKeyHandler = KEY_HANDLERS.some((handler) =>
        hasJsxPropIgnoreCase(node.attributes, handler),
      );
      if (hasKeyHandler) return;

      context.report({ node: node.name, message: MESSAGE });
    },
  }),
});
