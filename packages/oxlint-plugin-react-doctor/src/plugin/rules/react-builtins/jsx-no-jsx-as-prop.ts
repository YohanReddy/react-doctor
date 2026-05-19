import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "JSX prop receives JSX created on every render — extract it or memoize to avoid re-renders.";

// Prop names that conventionally receive single JSX elements (icons,
// slot content, fallbacks, render props). For these the inline JSX
// IS the canonical pattern — every shadcn / Radix / MUI / Mantine /
// Chakra / tldraw / Excalidraw component has an `icon`, `tooltip`,
// `header`, `fallback`, etc. slot. Flagging them creates massive
// noise for design-system consumers without any actionable signal.
const KNOWN_SLOT_PROP_NAMES: ReadonlySet<string> = new Set([
  // Icon slots
  "icon",
  "Icon",
  "iconLeft",
  "iconRight",
  "leftIcon",
  "rightIcon",
  "startIcon",
  "endIcon",
  "prefixIcon",
  "suffixIcon",
  "iconBefore",
  "iconAfter",
  // Generic content slots
  "prefix",
  "suffix",
  "before",
  "after",
  "header",
  "footer",
  "title",
  "subtitle",
  "description",
  "caption",
  "label",
  "tooltip",
  "trigger",
  "triggerContent",
  "content",
  "body",
  "action",
  "actions",
  "controls",
  "placeholder",
  "endAdornment",
  "startAdornment",
  "leftSection",
  "rightSection",
  "addonBefore",
  "addonAfter",
  "selectButton",
  // Fallback / error slots
  "fallback",
  "fallbackRender",
  "FallbackComponent",
  "ErrorFallback",
  "loadingFallback",
  "loader",
  "errorElement",
  // Common render-prop conventions
  "render",
  "renderItem",
  "renderRow",
  "renderCell",
  "renderEmpty",
  "renderError",
  "renderLoading",
  "renderHeader",
  "renderFooter",
  "renderItemActions",
  "renderName",
  "renderContent",
  "renderTrigger",
  "renderOption",
]);

const isJsxProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "JSXElement") || isNodeOfType(stripped, "JSXFragment")) return true;
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isJsxProducingExpression(stripped.left) || isJsxProducingExpression(stripped.right);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isJsxProducingExpression(stripped.consequent) || isJsxProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalJsxBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isJsxProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_jsx_as_prop`. Same shape
// as the other react_perf ports; flags `<C jsx={<X />} />` /
// `<C jsx={a || <X />} />` / `<C jsx={a ? a : <X />} />` inside any
// function scope. LIMITATION: scope-analysis cases (a JSX element bound
// to a local variable inside a render function) require scope info we
// don't track — those tests are not ported.
export const jsxNoJsxAsProp = defineRule<Rule>({
  id: "jsx-no-jsx-as-prop",
  severity: "warn",
  // React Compiler auto-memoizes inline JSX. The perf footgun this rule
  // guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation: "Hoist the inner JSX outside the render or memoize via `useMemo`.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements aren't memoized; flagging inline JSX
        // passed as a prop on them is unactionable. See
        // `jsx-no-new-function-as-prop` for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // Known slot prop names (icon, tooltip, fallback, header, etc.)
        // are designed to receive JSX. Flagging them is unactionable.
        if (
          isNodeOfType(node.name, "JSXIdentifier") &&
          KNOWN_SLOT_PROP_NAMES.has(node.name.name)
        ) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isJsxProducingExpression(expressionNode) &&
          !followsRenderLocalJsxBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
