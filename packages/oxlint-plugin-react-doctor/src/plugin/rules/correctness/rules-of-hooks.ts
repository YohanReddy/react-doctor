import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;
const COMPONENT_NAME_PATTERN = /^[A-Z]/;

const isHookName = (name: string): boolean => HOOK_NAME_PATTERN.test(name);

const isComponentOrHookName = (name: string): boolean =>
  COMPONENT_NAME_PATTERN.test(name) || isHookName(name);

const getHookName = (node: EsTreeNodeOfType<"CallExpression">): string | null => {
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier") && isHookName(callee.name)) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    isHookName(callee.property.name)
  )
    return callee.property.name;
  return null;
};

const getEnclosingFunction = (
  node: EsTreeNode,
):
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    )
      return current;
    current = current.parent;
  }
  return null;
};

const getFunctionName = (
  node:
    | EsTreeNodeOfType<"FunctionDeclaration">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"ArrowFunctionExpression">,
): string | null => {
  if (isNodeOfType(node, "FunctionDeclaration") && node.id) return node.id.name;
  if (isNodeOfType(node, "FunctionExpression") && node.id) return node.id.name;

  const parent = node.parent;
  if (!parent) return null;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier"))
    return parent.id.name;
  if (isNodeOfType(parent, "AssignmentExpression") && isNodeOfType(parent.left, "Identifier"))
    return parent.left.name;
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    isNodeOfType(parent.left, "MemberExpression") &&
    isNodeOfType(parent.left.property, "Identifier")
  )
    return parent.left.property.name;
  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier"))
    return parent.key.name;
  return null;
};

const isInsideConditional = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== functionNode) {
    if (isNodeOfType(current, "IfStatement") || isNodeOfType(current, "ConditionalExpression"))
      return true;
    if (isNodeOfType(current, "LogicalExpression")) {
      if (current.right === node || isDescendantOf(node, current.right)) return true;
    }
    if (isNodeOfType(current, "SwitchCase")) return true;
    current = current.parent;
  }
  return false;
};

const isInsideLoop = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== functionNode) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    )
      return true;
    current = current.parent;
  }
  return false;
};

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const isInsideClassComponent = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "ClassDeclaration") || isNodeOfType(current, "ClassExpression"))
      return true;
    current = current.parent;
  }
  return false;
};

const isInsideNestedCallback = (node: EsTreeNode, componentFunction: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== componentFunction) {
    if (
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionDeclaration")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const isMemoOrForwardRefCallback = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  const callee = parent.callee;
  if (isNodeOfType(callee, "Identifier"))
    return callee.name === "memo" || callee.name === "forwardRef";
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier"))
    return callee.property.name === "memo" || callee.property.name === "forwardRef";
  return false;
};

export const rulesOfHooks = defineRule<Rule>({
  id: "rules-of-hooks",
  severity: "error",
  recommendation:
    "Only call Hooks at the top level of a React function component or custom Hook — do not call them in loops, conditions, or nested functions",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const hookName = getHookName(node);
      if (!hookName) return;

      const enclosingFunction = getEnclosingFunction(node);

      if (!enclosingFunction) {
        context.report({
          node,
          message: `React Hook "${hookName}" cannot be called at the top level. React Hooks must be called in a React function component or a custom React Hook function.`,
        });
        return;
      }

      if (isInsideClassComponent(node)) {
        context.report({
          node,
          message: `React Hook "${hookName}" cannot be called in a class component. React Hooks must be called in a React function component or a custom React Hook function.`,
        });
        return;
      }

      const functionName = getFunctionName(enclosingFunction);

      const isAsync = "async" in enclosingFunction && enclosingFunction.async;
      if (isAsync && functionName && isComponentOrHookName(functionName)) {
        context.report({
          node,
          message: `React Hook "${hookName}" cannot be called in an async function.`,
        });
        return;
      }

      const isDirectInFunction = !isInsideNestedCallback(node, enclosingFunction);

      if (isDirectInFunction) {
        if (functionName && !isComponentOrHookName(functionName)) {
          context.report({
            node,
            message: `React Hook "${hookName}" is called in function "${functionName}" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".`,
          });
          return;
        }

        const isUseCall = hookName === "use";

        if (!isUseCall && isInsideLoop(node, enclosingFunction)) {
          context.report({
            node,
            message: `React Hook "${hookName}" may be executed more than once. Possibly because it is called in a loop. React Hooks must be called in the exact same order in every component render.`,
          });
          return;
        }

        if (!isUseCall && isInsideConditional(node, enclosingFunction)) {
          context.report({
            node,
            message: `React Hook "${hookName}" is called conditionally. React Hooks must be called in the exact same order in every component render.`,
          });
          return;
        }
      } else {
        if (!isMemoOrForwardRefCallback(enclosingFunction)) {
          const enclosingFunctionName = getFunctionName(enclosingFunction);
          if (enclosingFunctionName && isComponentOrHookName(enclosingFunctionName)) {
            context.report({
              node,
              message: `React Hook "${hookName}" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.`,
            });
            return;
          }

          let outerFunction: EsTreeNode | null | undefined = enclosingFunction.parent;
          while (outerFunction) {
            if (
              isNodeOfType(outerFunction, "FunctionDeclaration") ||
              isNodeOfType(outerFunction, "FunctionExpression") ||
              isNodeOfType(outerFunction, "ArrowFunctionExpression")
            ) {
              const outerName = getFunctionName(outerFunction);
              if (outerName && isComponentOrHookName(outerName)) {
                context.report({
                  node,
                  message: `React Hook "${hookName}" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.`,
                });
                return;
              }
              break;
            }
            outerFunction = outerFunction.parent;
          }
        }
      }
    },
  }),
});
