import { APP_ROUTER_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const containsUppercaseJsxChild = (node: EsTreeNode): boolean => {
  let foundChild = false;
  walkAst(node, (child) => {
    if (foundChild) return;
    if (isNodeOfType(child, "JSXOpeningElement")) {
      const name = child.name;
      if (isNodeOfType(name, "JSXIdentifier") && /^[A-Z]/.test(name.name)) foundChild = true;
    }
  });
  return foundChild;
};

const isPromiseConcurrencyAwait = (declarator: EsTreeNode): boolean => {
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.init, "AwaitExpression")) return false;
  const argument = declarator.init.argument;
  if (!isNodeOfType(argument, "CallExpression")) return false;
  const callee = argument.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Promise" &&
    isNodeOfType(callee.property, "Identifier") &&
    (callee.property.name === "all" || callee.property.name === "allSettled")
  );
};

export const serverParallelFetching = defineRule<Rule>({
  id: "server-parallel-fetching",
  severity: "warn",
  recommendation:
    "Push data fetching into child Server Components or start promises before awaiting so sibling work can stream in parallel",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    return {
      ReturnStatement(node: EsTreeNodeOfType<"ReturnStatement">) {
        if (!APP_ROUTER_FILE_PATTERN.test(filename)) return;
        if (!node.argument || !containsUppercaseJsxChild(node.argument)) return;
        let parent = node.parent;
        while (
          parent &&
          !isNodeOfType(parent, "FunctionDeclaration") &&
          !isNodeOfType(parent, "ArrowFunctionExpression")
        ) {
          parent = parent.parent;
        }
        if (!isNodeOfType(parent?.body, "BlockStatement")) return;
        let sequentialAwaitCount = 0;
        for (const statement of parent.body.body ?? []) {
          if (statement === node) break;
          if (!isNodeOfType(statement, "VariableDeclaration")) continue;
          if (
            statement.declarations?.some(
              (declarator: EsTreeNode) =>
                isNodeOfType(declarator, "VariableDeclarator") &&
                isNodeOfType(declarator.init, "AwaitExpression") &&
                !isPromiseConcurrencyAwait(declarator),
            )
          ) {
            sequentialAwaitCount++;
          }
        }
        if (sequentialAwaitCount < 2) return;
        context.report({
          node,
          message:
            "Server Component awaits parent data before rendering child components — push data fetching into children or start promises before awaiting so sibling work can stream in parallel",
        });
      },
    };
  },
});
