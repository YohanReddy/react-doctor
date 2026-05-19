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
  "JSX prop receives a new Function on every render — extract it or memoize (`useCallback`) to avoid re-renders.";

// Handler / render-prop names that conventionally fire at most once
// per component lifecycle (mount / unmount / ready / error / load /
// destroy / completion / open / close) OR are render-prop slots
// called per-render but only when the slot is mounted (one-shot
// fallbacks, render-as-function patterns, custom UI hooks).
//
// For these, a new function reference per render has zero measurable
// perf impact — the handler isn't called in a hot interaction path,
// and even if the surrounding component is memoized and re-renders,
// the handler still fires the same number of times.
const ONE_SHOT_LIFECYCLE_HANDLER_NAMES: ReadonlySet<string> = new Set([
  "onMount",
  "onUnmount",
  "onReady",
  "onInit",
  "onLoad",
  "onDestroy",
  "onBeforeMount",
  "onAfterMount",
  "onBeforeUnmount",
  "onAfterUnmount",
  "onError",
  "onComplete",
  "onCompleted",
  "onFinish",
  "onFinished",
  "onSuccess",
  "onAbort",
  "onOpen",
  "onClose",
  "onDismiss",
  "onCancel",
  "onConfirm",
  // Save / submit / commit / remove / delete — intent-class callbacks
  // that fire at most once per user action (not per render or per
  // pointer-move). New function reference per render has no measurable
  // perf impact: the handler doesn't run in any hot path.
  "onSave",
  "onSubmit",
  "onCommit",
  "onApply",
  "onRemove",
  "onDelete",
  "onDuplicate",
  "onReset",
  "onRetry",
  "onRefresh",
  "onAdd",
  "onCreate",
  "onUpdate",
  // Compound action-button conventions (`onConfirmClick`, `onAcceptClick`)
  "onConfirmClick",
  "onAcceptClick",
  "onCancelClick",
  "onSaveClick",
  // Outside-click / press-enter / escape / context-menu — sparse user
  // intent, not per-render or per-pointer-move events.
  "onClickOutside",
  "onPressEnter",
  "onEnter",
  "onEscape",
  "onLeave",
  // Drag / drop — fires on action completion, not per-frame; consumers
  // don't memo on these refs.
  "onDragStart",
  "onDragEnd",
  "onDrop",
  "onSort",
  // Render-prop / customization slots — accept a function that's
  // either called once (fallback) or used by the parent to render
  // subviews. Real perf hits flow through the children, not the
  // identity of these slot functions.
  "fallback",
  "fallbackRender",
  "render",
  "renderItem",
  "renderRow",
  "renderCell",
  "renderEmpty",
  "renderError",
  "renderLoading",
  "renderHeader",
  "renderFooter",
  "renderName",
  "renderContent",
  "renderTrigger",
  "renderOption",
  "renderItemActions",
  "children",
  "useCustom",
]);

// Render-prop suffix conventions — `render*`, `*Render`, `*Renderer`,
// `*Slot`, `*Component`, `*Element` props receiving callable values.
const ONE_SHOT_HANDLER_SUFFIXES: ReadonlyArray<string> = [
  "Render",
  "Renderer",
  "Slot",
  "Component",
  "Element",
];

const isOneShotHandlerName = (propName: string): boolean => {
  if (ONE_SHOT_LIFECYCLE_HANDLER_NAMES.has(propName)) return true;
  if (propName.startsWith("render") && propName.length > 6) {
    const fourthCharCode = propName.charCodeAt(6);
    // `render<X>` where X is uppercase A-Z = render-prop convention
    if (fourthCharCode >= 65 && fourthCharCode <= 90) return true;
  }
  for (const suffix of ONE_SHOT_HANDLER_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const isFunctionProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "FunctionDeclaration")
  ) {
    return true;
  }
  if (isNodeOfType(stripped, "NewExpression")) {
    return isNodeOfType(stripped.callee, "Identifier") && stripped.callee.name === "Function";
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (isNodeOfType(stripped.callee, "Identifier") && stripped.callee.name === "Function") {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.property, "Identifier") &&
      stripped.callee.property.name === "bind"
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isFunctionProducingExpression(stripped.left) || isFunctionProducingExpression(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isFunctionProducingExpression(stripped.consequent) ||
      isFunctionProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalFunctionBinding = (
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
  return isFunctionProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_function_as_prop`.
// Inline-expression coverage only — see jsx-no-new-array-as-prop's
// LIMITATION note for the scope-analysis cases (`const x = () => {};
// return <C onClick={x} />`) we don't catch yet.
export const jsxNoNewFunctionAsProp = defineRule<Rule>({
  id: "jsx-no-new-function-as-prop",
  severity: "warn",
  // React Compiler auto-memoizes inline callbacks. The perf footgun this
  // rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation: "Memoize the callback (`useCallback`) or hoist it outside the component.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements (`<button onClick={...}>`) aren't
        // memoized — neither the browser nor React caches DOM event
        // listeners, so a new function per render has no measurable
        // cost. Flagging them is unactionable noise. The rule still
        // fires on custom-component props where downstream `React.memo`
        // bails on the new reference.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        // One-shot lifecycle handlers (onMount / onError / onClose /
        // etc.) and render-prop slots (`fallback`, `render*`, `*Render`,
        // `*Renderer`, etc.) accept inline functions by design — they
        // either fire at most once per lifecycle or are used by the
        // parent for opaque rendering. New function reference per
        // render has zero measurable perf impact.
        if (isNodeOfType(node.name, "JSXIdentifier") && isOneShotHandlerName(node.name.name)) {
          return;
        }
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isFunctionProducingExpression(expressionNode) &&
          !followsRenderLocalFunctionBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
