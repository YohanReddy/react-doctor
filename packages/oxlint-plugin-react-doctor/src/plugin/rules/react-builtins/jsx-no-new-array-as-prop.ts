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
  "JSX prop receives a new Array on every render — extract it or memoize to avoid re-renders.";

const ARRAY_CONSTRUCTOR_NAMES = new Set(["Array"]);
// `.map(fn)` / `.filter(fn)` always take exactly one callback argument
// — flagging them with a different arity is almost certainly a false
// positive on a non-Array `.map`/`.filter` (e.g. `Map#map` doesn't exist
// but custom utilities might). `.concat` is the odd one: zero args is a
// shallow copy, multi-args is a multi-element concat — both still
// allocate a new array, so we don't restrict by arity for it.
const SINGLE_ARG_ARRAY_METHODS = new Set(["map", "filter"]);
const ANY_ARG_ARRAY_METHODS = new Set(["concat"]);

const isArrayProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ArrayExpression")) return true;
  if (isNodeOfType(stripped, "NewExpression")) {
    return (
      isNodeOfType(stripped.callee, "Identifier") &&
      ARRAY_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (
      isNodeOfType(stripped.callee, "Identifier") &&
      ARRAY_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.property, "Identifier")
    ) {
      const methodName = stripped.callee.property.name;
      if (SINGLE_ARG_ARRAY_METHODS.has(methodName) && stripped.arguments.length === 1) {
        return true;
      }
      if (ANY_ARG_ARRAY_METHODS.has(methodName)) return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isArrayProducingExpression(stripped.left) || isArrayProducingExpression(stripped.right);
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isArrayProducingExpression(stripped.consequent) ||
      isArrayProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalArrayBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  // Only flag if the binding's scope owner is also an ancestor of the
  // JSX attribute — i.e. the binding lives in the same render call.
  // Hoisted bindings (module-level / outside the render function) are
  // exempt because they aren't allocated per render.
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      // Found the scope owner among JSX's ancestors — it's render-local
      // unless it IS the Program (module scope).
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isArrayProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_array_as_prop`. Flags
// JSX prop values that allocate a new Array per render: `[]`,
// `new Array()`, `Array()`, `arr.concat(x)`, `arr.map(...)`, `arr.filter(...)`,
// and these wrapped in conditional / logical expressions. Top-level JSX
// (outside any function) is skipped — those allocations happen once.
//
// LIMITATION vs OXC: OXC additionally tracks identifier references and
// flags `let x = []; return <C list={x} />` (variable initialized inside
// a render scope). Without scope analysis we don't follow those refs;
// document and skip those tests.
export const jsxNoNewArrayAsProp = defineRule<Rule>({
  id: "jsx-no-new-array-as-prop",
  severity: "warn",
  // React Compiler auto-memoizes prop allocations. The perf footgun this
  // rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation: "Memoize the array (`useMemo`) or hoist it outside the component.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements aren't memoized; flagging inline
        // arrays on them is unactionable. See `jsx-no-new-function-as-prop`
        // for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        if (!isInsideFunctionScope(node)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isArrayProducingExpression(expressionNode) &&
          !followsRenderLocalArrayBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
