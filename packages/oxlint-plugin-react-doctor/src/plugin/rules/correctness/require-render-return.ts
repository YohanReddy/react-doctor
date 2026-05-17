import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const MESSAGE =
  "render() method must return a value — components without a return statement render nothing";

const blockHasReturnStatement = (body: EsTreeNodeOfType<"BlockStatement">): boolean => {
  for (const statement of body.body) {
    if (isNodeOfType(statement, "ReturnStatement")) return true;
    if (isNodeOfType(statement, "IfStatement")) {
      if (ifBranchesAllReturn(statement)) return true;
    }
    if (isNodeOfType(statement, "SwitchStatement")) {
      if (switchCasesAllReturn(statement)) return true;
    }
  }
  return false;
};

const ifBranchesAllReturn = (node: EsTreeNodeOfType<"IfStatement">): boolean => {
  const consequentReturns = statementReturns(node.consequent);
  if (!consequentReturns) return false;
  if (!node.alternate) return false;
  if (isNodeOfType(node.alternate, "IfStatement")) return ifBranchesAllReturn(node.alternate);
  return statementReturns(node.alternate);
};

const switchCasesAllReturn = (node: EsTreeNodeOfType<"SwitchStatement">): boolean => {
  if (node.cases.length === 0) return false;
  const hasDefault = node.cases.some((switchCase) => switchCase.test === null);
  if (!hasDefault) return false;
  return node.cases.every((switchCase) =>
    switchCase.consequent.some((statement) => isNodeOfType(statement, "ReturnStatement")),
  );
};

const statementReturns = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return true;
  if (isNodeOfType(node, "BlockStatement")) return blockHasReturnStatement(node);
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

const isCreateReactClassCall = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "CallExpression")) {
      const callee = current.callee;
      if (isNodeOfType(callee, "Identifier") && callee.name === "createReactClass") return true;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "createClass"
      )
        return true;
    }
    current = current.parent;
  }
  return false;
};

export const requireRenderReturn = defineRule<Rule>({
  id: "require-render-return",
  severity: "error",
  recommendation: MESSAGE,
  create: (context: RuleContext) => ({
    MethodDefinition(node: EsTreeNodeOfType<"MethodDefinition">) {
      if (!isNodeOfType(node.key, "Identifier") || node.key.name !== "render") return;
      if (!isInsideClassComponent(node)) return;
      const body = node.value?.body;
      if (!body || !isNodeOfType(body, "BlockStatement")) return;
      if (!blockHasReturnStatement(body)) {
        context.report({ node, message: MESSAGE });
      }
    },
    Property(node: EsTreeNodeOfType<"Property">) {
      if (!isNodeOfType(node.key, "Identifier") || node.key.name !== "render") return;
      if (!isCreateReactClassCall(node)) return;
      const value = node.value;
      if (isNodeOfType(value, "FunctionExpression")) {
        const body = value.body;
        if (isNodeOfType(body, "BlockStatement") && !blockHasReturnStatement(body)) {
          context.report({ node, message: MESSAGE });
        }
      }
    },
  }),
});
