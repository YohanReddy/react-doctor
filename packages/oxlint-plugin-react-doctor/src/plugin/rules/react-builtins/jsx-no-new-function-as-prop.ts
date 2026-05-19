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
