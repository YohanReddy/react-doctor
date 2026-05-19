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
  // PascalCase render-slot props (`Icon={() => <X/>}`, `Trigger={…}`,
  // etc.) — by convention these receive a render function whose output
  // is inserted directly into the tree. Identity doesn't matter.
  "Icon",
  "Trigger",
  "Header",
  "Footer",
  "Label",
  "Content",
  "Adornment",
  "Indicator",
  "Tooltip",
  "Badge",
  "Panel",
  "Overlay",
  "Section",
  "Button",
  "Action",
  // Radix / Headless UI controlled-state callbacks — fire on user
  // interaction, not per render, and library consumers don't memoize
  // by their identity.
  "onValueChange",
  "onCheckedChange",
  "onOpenChange",
  "onSelectionChange",
  "onPressedChange",
  "onToggleChange",
  "onSearch",
  "onSearchChange",
  "onClear",
  "onReset",
  "onCopy",
  "onPaste",
  "onPick",
  "onActiveChange",
  "onExpandedChange",
  "onSortChange",
  "onFilterChange",
  "onSelectChange",
  // Common selection / toggle / navigation intent callbacks — fire on
  // discrete user actions, not per render.
  "onSelect",
  "onToggle",
  "onTab",
  "onShiftTab",
  "onBack",
  "onForward",
  "onPrev",
  "onNext",
  "onSkip",
  "onContinue",
  "onPressCmdEnter",
  "onPressCmdK",
  "onCloseRequest",
  "onCloseRequested",
  "onRowClick",
  "onCellClick",
  "onHeaderClick",
  "onToggleExpand",
  "onToggleCollapse",
  "onVisibilityChange",
  "onVariableSelect",
  "onSelectColor",
  // Generic intent / action callbacks (per-action, not per-render)
  "action",
  "onEdit",
  "onView",
  "onApprove",
  "onReject",
  "onArchive",
  "onUnarchive",
  "onPin",
  "onUnpin",
  "onShare",
  "onDownload",
  "onUpload",
  "onPrint",
  "onExport",
  "onImport",
  "onMove",
  "onRename",
  // Table-row callbacks (antd / data-table style) — per-row, not per-render
  "rowKey",
  "onRow",
  "onCell",
  "onHeader",
  "onHeaderRow",
  "onHeaderCell",
  "onPageChange",
  "onTabChange",
  // Form field common per-action callbacks
  "onNameChange",
  "onDescriptionChange",
  "onInputChange",
  "onLabelChange",
  "onValueCommit",
  "onCommit",
]);

// Render-prop / slot / customization suffix conventions — `render*`,
// `*Render`, `*Renderer`, `*Slot`, `*Component`, `*Element`, plus
// PascalCase-suffix slot props (`actionButton`, `closeIcon`, etc.).
const ONE_SHOT_HANDLER_SUFFIXES: ReadonlyArray<string> = [
  "Render",
  "Renderer",
  "Slot",
  "Component",
  "Element",
  "Icon",
  "Trigger",
  "Header",
  "Footer",
  "Label",
  "Content",
  "Adornment",
  "Indicator",
  "Tooltip",
  "Badge",
  "Panel",
  "Overlay",
  "Section",
  "Button",
  "Action",
  "Override",
  "Fallback",
];

// `get*`, `format*`, `parse*`, `validate*`, `is*`, `should*`, `match*`,
// `select*`, `to*` — pure-ish accessor / predicate / formatter function
// props called on demand, not on every render. New identity is OK.
const ACCESSOR_PREDICATE_PREFIXES: ReadonlyArray<string> = [
  "get",
  "format",
  "parse",
  "validate",
  "is",
  "should",
  "match",
  "select",
  "filter",
  "compare",
];

const isAccessorPredicateName = (propName: string): boolean => {
  for (const prefix of ACCESSOR_PREDICATE_PREFIXES) {
    if (propName.length <= prefix.length) continue;
    if (!propName.startsWith(prefix)) continue;
    const nextChar = propName.charCodeAt(prefix.length);
    // require uppercase after the prefix (so `get` doesn't false-match
    // `gather`, `should` doesn't match `shouldery`, etc.)
    if (nextChar >= 65 && nextChar <= 90) return true;
  }
  return false;
};

const isOneShotHandlerName = (propName: string): boolean => {
  if (ONE_SHOT_LIFECYCLE_HANDLER_NAMES.has(propName)) return true;
  if (propName.startsWith("render") && propName.length > 6) {
    const fourthCharCode = propName.charCodeAt(6);
    // `render<X>` where X is uppercase A-Z = render-prop convention
    if (fourthCharCode >= 65 && fourthCharCode <= 90) return true;
  }
  if (isAccessorPredicateName(propName)) return true;
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

// `(…params) => fn(arg1, arg2, …)` — an arrow whose ENTIRE body is a
// single call (or method invocation) where every argument is a stable
// value (literal, identifier, member access, the arrow's own param, or
// a chain expression of those). The wrapper exists purely to adapt the
// caller's signature to the inner call's argument list — and the user
// CAN'T `useCallback` it: the closure MUST capture the outer scope's
// identifier references (which themselves often aren't stable). The
// only "fix" would be restructuring the data flow (`<X arg={…} />`
// instead of `onClick={(e) => fn(arg, e)}`), which is a major refactor
// for a tiny perf gain that only materializes on `React.memo` consumers
// — most internal app components aren't memo'd, so the cost is zero.
//
// Covered shapes (all skipped):
//   () => fn()
//   () => fn(literal, outerIdentifier)
//   (e) => fn(e)
//   (e) => e.stopPropagation()
//   (value) => onChange?.(value)
//   (x) => x?.foo.bar
//   (a, b) => fn(a, b)
//   (e) => e.key === 'Enter' && saveProperty()
//
// NOT covered (still flagged):
//   () => fn({ ... })       — inline object construction is per-render
//   () => fn([...x, ...])   — inline array
//   () => { setA(); setB(); } — multiple statements (real work)
//   () => () => fn()        — returns a function (HoC-style)
const isStableArgumentValue = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.expressions ?? []).every((expression) =>
      isStableArgumentValue(expression as EsTreeNode),
    );
  }
  if (isNodeOfType(node, "Identifier")) return true;
  if (isNodeOfType(node, "MemberExpression")) return true;
  if (isNodeOfType(node, "UnaryExpression")) {
    return isStableArgumentValue(node.argument as EsTreeNode);
  }
  if (isNodeOfType(node, "ChainExpression")) {
    return isStableArgumentValue(node.expression as EsTreeNode);
  }
  return false;
};

const isStableCallExpression = (node: EsTreeNode): boolean => {
  let inner = node;
  if (isNodeOfType(inner, "ChainExpression")) inner = inner.expression as EsTreeNode;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee;
  if (
    !isNodeOfType(callee, "Identifier") &&
    !isNodeOfType(callee, "MemberExpression")
  )
    return false;
  for (const argument of inner.arguments ?? []) {
    if (!isStableArgumentValue(argument as EsTreeNode)) return false;
  }
  return true;
};

const isLightweightBodyExpression = (body: EsTreeNode): boolean => {
  // Direct call: `(e) => fn(e)`, `(e) => e.method()`, `(v) => fn?.(v)`
  if (isStableCallExpression(body)) return true;
  if (isNodeOfType(body, "ChainExpression")) {
    return isLightweightBodyExpression(body.expression as EsTreeNode);
  }
  // Short-circuit guard: `(e) => e.key === 'Enter' && saveProperty()`
  // — accepted only when at least one side is a real call (the
  // wrapper exists to invoke something, not return a static value).
  if (
    isNodeOfType(body, "LogicalExpression") &&
    (body.operator === "&&" || body.operator === "||" || body.operator === "??")
  ) {
    const leftLightweight = isLightweightBodyExpression(body.left as EsTreeNode);
    const rightLightweight = isLightweightBodyExpression(body.right as EsTreeNode);
    if (!leftLightweight || !rightLightweight) return false;
    const leftIsCall =
      isNodeOfType(body.left as EsTreeNode, "CallExpression") ||
      (isNodeOfType(body.left as EsTreeNode, "ChainExpression") &&
        isNodeOfType((body.left as EsTreeNodeOfType<"ChainExpression">).expression as EsTreeNode, "CallExpression"));
    const rightIsCall =
      isNodeOfType(body.right as EsTreeNode, "CallExpression") ||
      (isNodeOfType(body.right as EsTreeNode, "ChainExpression") &&
        isNodeOfType((body.right as EsTreeNodeOfType<"ChainExpression">).expression as EsTreeNode, "CallExpression"));
    return leftIsCall || rightIsCall;
  }
  // Pure-value or no-call bodies (`() => true`, `(x) => x.length`) get
  // flagged — these can be trivially hoisted (`const T = () => true`).
  return false;
};

const isParameterBindingWrapper = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "ArrowFunctionExpression")) return false;
  // Body is either expression-form, single `return expr;`, or single
  // expression statement. Multi-statement blocks are real work; flag those.
  let body = stripped.body as EsTreeNode;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    if (statements.length !== 1) return false;
    const only = statements[0] as EsTreeNode;
    if (isNodeOfType(only, "ReturnStatement")) {
      if (!only.argument) return false;
      body = only.argument as EsTreeNode;
    } else if (isNodeOfType(only, "ExpressionStatement")) {
      body = only.expression as EsTreeNode;
    } else {
      return false;
    }
  }
  return isLightweightBodyExpression(body);
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
        // Parameter-binding wrappers (`() => fn(arg1, arg2)`) can't be
        // useCallback-ed — the closure must capture `arg1`/`arg2`.
        if (isParameterBindingWrapper(expressionNode)) return;
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
