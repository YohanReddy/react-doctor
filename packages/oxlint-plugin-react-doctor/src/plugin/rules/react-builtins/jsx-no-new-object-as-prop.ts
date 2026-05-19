import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "JSX prop receives a new Object on every render — extract it or memoize to avoid re-renders.";

// Props that ALWAYS receive a fresh object by React's API contract —
// flagging them is unactionable noise. `dangerouslySetInnerHTML` MUST be
// `{ __html: ... }`; `style` is the documented React inline-style API
// and inlining is idiomatic for one-shot components where memo perf is
// irrelevant. Suppress both regardless of the wrapping component.
const ALWAYS_FRESH_OBJECT_PROPS: ReadonlySet<string> = new Set([
  "dangerouslySetInnerHTML",
  "style",
]);

const OBJECT_CONSTRUCTOR_NAMES = new Set(["Object"]);
const OBJECT_PRODUCING_METHODS = new Set([
  "assign",
  "create",
  "fromEntries",
  "groupBy",
  "freeze",
  "seal",
]);

const isObjectProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return true;
  if (isNodeOfType(stripped, "NewExpression")) {
    return (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.object, "Identifier") &&
      stripped.callee.object.name === "Object" &&
      isNodeOfType(stripped.callee.property, "Identifier") &&
      OBJECT_PRODUCING_METHODS.has(stripped.callee.property.name)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isObjectProducingExpression(stripped.left) || isObjectProducingExpression(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isObjectProducingExpression(stripped.consequent) ||
      isObjectProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalObjectBinding = (
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
  return isObjectProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_object_as_prop`.
// See `jsx-no-new-array-as-prop` for the shared shape; this one flags
// ObjectExpression / new Object() / Object.assign() / Object.create()
// etc. and the same conditional / logical wrappings. LIMITATION: same
// scope-analysis gap noted there.
export const jsxNoNewObjectAsProp = defineRule<Rule>({
  id: "jsx-no-new-object-as-prop",
  severity: "warn",
  // React Compiler auto-memoizes prop allocations, so the perf footgun
  // this rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation: "Memoize the object (`useMemo`) or hoist it outside the component.",
  category: "Performance",
  create: (context) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isInsideFunctionScope(node)) return;
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (ALWAYS_FRESH_OBJECT_PROPS.has(node.name.name)) return;
      const value = node.value;
      if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
      const expression = value.expression;
      if (!expression || expression.type === "JSXEmptyExpression") return;
      const expressionNode = expression as EsTreeNode;
      if (
        !isObjectProducingExpression(expressionNode) &&
        !followsRenderLocalObjectBinding(expressionNode, node)
      ) {
        return;
      }
      context.report({ node, message: MESSAGE });
    },
  }),
});
