import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "A control must be associated with a text label — add visible text, `aria-label`, or `aria-labelledby`.";

interface ControlHasAssociatedLabelSettings {
  depth?: number;
  labelAttributes?: ReadonlyArray<string>;
  controlComponents?: ReadonlyArray<string>;
  ignoreElements?: ReadonlyArray<string>;
  ignoreRoles?: ReadonlyArray<string>;
}

// `link` is upstream's only default-ignored element. We add `canvas`
// because a canvas is a drawing surface — it can't have a *text label*
// (its child text is a screen-reader fallback that doesn't satisfy the
// rule's "labelled control" model), and almost every flagged hit in
// real codebases is unactionable (devtools overlays, internal SDK
// canvases, etc.). Users who genuinely need labels on canvases (rare)
// set `aria-label` and the labelling-prop check passes; users who want
// to enforce regardless can override via `ignoreElements: []`.
const DEFAULT_IGNORE_ELEMENTS: ReadonlyArray<string> = ["link", "canvas"];
const DEFAULT_LABELLING_PROPS: ReadonlyArray<string> = ["alt", "aria-label", "aria-labelledby"];

// Default depth for the children-walk. Upstream `eslint-plugin-jsx-a11y`
// defaults to 2, but real-world buttons routinely nest text deeper
// (icon + label inside flex wrappers easily reaches depth 4-5). The
// shallow default makes the rule miss visible text labels and emit
// false positives at scale.
const DEFAULT_DEPTH = 5;
const MAX_DEPTH = 25;

// Test / story / Cypress files don't participate in production
// accessibility audits — they exercise component shapes, not user
// flows. Skipping them removes a steady stream of FPs (test fixtures
// rendering bare `<input ref={...}/>` without labels). Shared helper
// is in `utils/is-testlike-filename.ts`.

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ControlHasAssociatedLabelSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { controlHasAssociatedLabel?: ControlHasAssociatedLabelSettings })
          .controlHasAssociatedLabel ?? {})
      : {};
  return {
    depth: Math.min(ruleSettings.depth ?? DEFAULT_DEPTH, MAX_DEPTH),
    labelAttributes: ruleSettings.labelAttributes ?? [],
    controlComponents: ruleSettings.controlComponents ?? [],
    ignoreElements: ruleSettings.ignoreElements ?? [],
    ignoreRoles: ruleSettings.ignoreRoles ?? [],
  };
};

// Returns true if any attribute on this opening element provides an
// accessible name (per OXC's `has_labelling_prop`). Spread attributes
// always count.
const hasLabellingProp = (
  attributes: ReadonlyArray<EsTreeNode>,
  customAttributes: ReadonlyArray<string>,
): boolean => {
  for (const attribute of attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) return true;
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name as EsTreeNode, "JSXIdentifier")) continue;
    const propName = getJsxAttributeName(attribute.name as EsTreeNodeOfType<"JSXIdentifier">);
    if (!propName) continue;
    const isLabelling =
      DEFAULT_LABELLING_PROPS.includes(propName) || customAttributes.includes(propName);
    if (!isLabelling) continue;
    if (!attribute.value) return false; // present but valueless
    if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
      return attribute.value.value.trim().length > 0;
    }
    return true;
  }
  return false;
};

interface CheckChildContext {
  depth: number;
  customAttributes: ReadonlyArray<string>;
  controlComponents: ReadonlyArray<string>;
  settings: Readonly<Record<string, unknown>> | undefined;
}

const checkChildForLabel = (
  child: EsTreeNode,
  currentDepth: number,
  context: CheckChildContext,
): boolean => {
  if (currentDepth > context.depth) return false;
  if (isNodeOfType(child, "JSXExpressionContainer")) return true;
  if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
  if (isNodeOfType(child, "JSXFragment")) {
    return child.children.some((nestedChild) =>
      checkChildForLabel(nestedChild as EsTreeNode, currentDepth + 1, context),
    );
  }
  if (isNodeOfType(child, "JSXElement")) {
    if (
      hasLabellingProp(child.openingElement.attributes as EsTreeNode[], context.customAttributes)
    ) {
      return true;
    }
    if (child.children.length === 0) {
      const tagName = getElementType(child.openingElement, context.settings);
      if (isReactComponentName(tagName) && !context.controlComponents.includes(tagName)) {
        return true;
      }
    }
    for (const nestedChild of child.children) {
      if (checkChildForLabel(nestedChild as EsTreeNode, currentDepth + 1, context)) return true;
    }
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::control_has_associated_label`.
export const controlHasAssociatedLabel = defineRule<Rule>({
  id: "control-has-associated-label",
  severity: "warn",
  recommendation: "Every interactive control must have an accessible label.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isTestlikeFile) return;
        const opening = node.openingElement;
        const tagName = getElementType(opening, context.settings);
        if (DEFAULT_IGNORE_ELEMENTS.includes(tagName)) return;
        if (settings.ignoreElements.includes(tagName)) return;

        const roleAttribute = hasJsxPropIgnoreCase(opening.attributes, "role");
        const role = roleAttribute ? getJsxPropStringValue(roleAttribute) : null;
        if (role && settings.ignoreRoles.includes(role)) return;
        if (isHiddenFromScreenReader(opening, context.settings)) return;

        const isDomElement = HTML_TAGS.has(tagName);
        const isInteractiveEl = isInteractiveElement(tagName, opening);
        const isInteractiveRoleEl = role !== null && isInteractiveRole(role);
        const isControlComponent = settings.controlComponents.includes(tagName);

        if (!(isInteractiveEl || (isDomElement && isInteractiveRoleEl) || isControlComponent)) {
          return;
        }

        if (hasLabellingProp(opening.attributes as EsTreeNode[], settings.labelAttributes)) {
          return;
        }
        const checkContext: CheckChildContext = {
          depth: settings.depth,
          customAttributes: settings.labelAttributes,
          controlComponents: settings.controlComponents,
          settings: context.settings,
        };
        for (const child of node.children) {
          if (checkChildForLabel(child as EsTreeNode, 1, checkContext)) return;
        }
        context.report({ node: opening, message: MESSAGE });
      },
    };
  },
});
