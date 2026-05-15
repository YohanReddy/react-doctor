import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isPromiseAllMapAwait = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "AwaitExpression") &&
  isNodeOfType(node.argument, "CallExpression") &&
  isNodeOfType(node.argument.callee, "MemberExpression") &&
  isNodeOfType(node.argument.callee.object, "Identifier") &&
  node.argument.callee.object.name === "Promise" &&
  isNodeOfType(node.argument.callee.property, "Identifier") &&
  node.argument.callee.property.name === "all" &&
  isNodeOfType(node.argument.arguments?.[0], "CallExpression") &&
  isNodeOfType(node.argument.arguments[0].callee, "MemberExpression") &&
  isNodeOfType(node.argument.arguments[0].callee.property, "Identifier") &&
  node.argument.arguments[0].callee.property.name === "map";

export const serverParallelNestedFetching = defineRule<Rule>({
  id: "server-parallel-nested-fetching",
  severity: "warn",
  recommendation:
    "Flatten nested Promise.all phases or start nested child promises inside the first map so each level does not wait for the previous one to finish",
  create: (context: RuleContext) => ({
    BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
      const statements = node.body ?? [];
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const current = statements[statementIndex];
        const next = statements[statementIndex + 1];
        if (
          !isNodeOfType(current, "VariableDeclaration") ||
          !isNodeOfType(next, "VariableDeclaration")
        ) {
          continue;
        }
        const currentDeclarator = current.declarations?.[0];
        const nextDeclarator = next.declarations?.[0];
        if (!isPromiseAllMapAwait(currentDeclarator?.init)) continue;
        if (!isPromiseAllMapAwait(nextDeclarator?.init)) continue;
        context.report({
          node: next,
          message:
            "nested Promise.all(map()) runs in phases — flatten the dependency graph or start child promises inside the first map so nested fetches are not serialized by level",
        });
      }
    },
  }),
});
