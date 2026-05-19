import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isAbstractRole } from "../../utils/is-abstract-role.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonInteractiveElement } from "../../utils/is-non-interactive-element.js";
import { isNonInteractiveRole } from "../../utils/is-non-interactive-role.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  'Static HTML elements with event handlers require a role — add `role="…"` or use a semantic HTML element instead.';

const DEFAULT_HANDLERS: ReadonlyArray<string> = [
  "onClick",
  "onMouseDown",
  "onMouseUp",
  "onKeyPress",
  "onKeyDown",
  "onKeyUp",
];

interface NoStaticElementInteractionsSettings {
  handlers?: ReadonlyArray<string>;
  allowExpressionValues?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoStaticElementInteractionsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noStaticElementInteractions?: NoStaticElementInteractionsSettings })
          .noStaticElementInteractions ?? {})
      : {};
  return {
    handlers: ruleSettings.handlers ?? DEFAULT_HANDLERS,
    allowExpressionValues: ruleSettings.allowExpressionValues ?? false,
  };
};

// True when the attribute value is `={null}`.
const isNullValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return false;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = attribute.value.expression;
  return (
    isNodeOfType(expression as EsTreeNode, "Literal") &&
    (expression as { value: unknown }).value === null
  );
};

// `<div onClick={(e) => e.stopPropagation()}>` is the canonical "block
// bubbling" idiom — the div isn't a user-interaction target, it just
// stops a click from reaching its parent. Adding role/keyboard handlers
// would be misleading (the div ISN'T a button), so the rule should
// pass through pure event-blocker handlers.
const BLOCKER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const isEventBlockerCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return BLOCKER_METHOD_NAMES.has(callee.property.name);
};

const isPureEventBlockerBody = (body: EsTreeNode | null | undefined): boolean => {
  if (!body) return false;
  if (isEventBlockerCall(body)) return true;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    // Require at least one statement, AND every statement must be a
    // blocker call. Empty `() => {}` is NOT a blocker — it's a no-op
    // that the rule should still flag as "non-interactive element with
    // a click handler".
    if (statements.length === 0) return false;
    for (const statement of statements) {
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      if (!isEventBlockerCall(statement.expression as EsTreeNode)) return false;
    }
    return true;
  }
  return false;
};

const isPureEventBlockerHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return false;
  }
  const expression = attribute.value.expression as EsTreeNode;
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return isPureEventBlockerBody(expression.body as EsTreeNode);
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::no_static_element_interactions`.
export const noStaticElementInteractions = defineRule<Rule>({
  id: "no-static-element-interactions",
  severity: "warn",
  recommendation:
    "Static HTML elements with event handlers require a role, or use a semantic HTML element instead.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        // Find any active handler — but pure event-blocker handlers
        // (`onClick={(e) => e.stopPropagation()}`) don't count as
        // "interactive": the element isn't a user-interaction target,
        // it's stopping a bubble. If EVERY active handler is a pure
        // blocker, the element is non-interactive and the rule should
        // pass through.
        let hasNonBlockerHandler = false;
        let hasAnyHandler = false;
        for (const handler of settings.handlers) {
          const attribute = hasJsxPropIgnoreCase(node.attributes, handler);
          if (!attribute) continue;
          if (isNullValue(attribute)) continue;
          hasAnyHandler = true;
          if (!isPureEventBlockerHandler(attribute)) {
            hasNonBlockerHandler = true;
            break;
          }
        }
        if (!hasAnyHandler) return;
        if (!hasNonBlockerHandler) return;

        const elementType = getElementType(node, context.settings);
        // Custom JSX elements pass through.
        if (!HTML_TAGS.has(elementType)) return;
        if (isHiddenFromScreenReader(node, context.settings)) return;
        if (isPresentationRole(node)) return;
        if (isInteractiveElement(elementType, node)) return;
        if (isNonInteractiveElement(elementType, node)) return;
        if (isAbstractRole(node, context.settings)) return;

        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute || !roleAttribute.value) {
          context.report({ node: node.name, message: MESSAGE });
          return;
        }

        const attributeValue = roleAttribute.value as EsTreeNode;
        if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
          const firstRole = attributeValue.value.toLowerCase().trim().split(/\s+/)[0];
          if (firstRole && (isInteractiveRole(firstRole) || isNonInteractiveRole(firstRole))) {
            return;
          }
          context.report({ node: node.name, message: MESSAGE });
          return;
        }
        if (
          isNodeOfType(attributeValue, "JSXExpressionContainer") &&
          settings.allowExpressionValues
        ) {
          return;
        }
        context.report({ node: node.name, message: MESSAGE });
      },
    };
  },
});
