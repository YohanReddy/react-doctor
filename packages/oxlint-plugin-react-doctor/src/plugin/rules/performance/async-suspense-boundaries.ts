import { PAGE_OR_LAYOUT_FILE_PATTERN, ROUTE_HANDLER_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const containsJsxNode = (node: EsTreeNode, targetName?: string): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return;
    if (isNodeOfType(child, "JSXOpeningElement")) {
      if (!targetName) {
        found = true;
        return false;
      }
      const name = child.name;
      if (isNodeOfType(name, "JSXIdentifier") && name.name === targetName) found = true;
    }
    if (isNodeOfType(child, "JSXFragment") && !targetName) {
      found = true;
      return false;
    }
  });
  return found;
};

export const asyncSuspenseBoundaries = defineRule<Rule>({
  id: "async-suspense-boundaries",
  severity: "warn",
  recommendation:
    "Wrap slow async child regions in Suspense boundaries so React can stream available UI while slower data resolves",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isSkippedFile =
      PAGE_OR_LAYOUT_FILE_PATTERN.test(filename) || ROUTE_HANDLER_FILE_PATTERN.test(filename);

    const checkAsyncComponent = (
      node: EsTreeNode,
      body: EsTreeNode | null | undefined,
      isAsync: boolean,
    ): void => {
      if (isSkippedFile) return;
      if (!isAsync || !body) return;
      if (!containsJsxNode(body)) return;
      if (containsJsxNode(body, "Suspense")) return;
      context.report({
        node,
        message:
          "async component renders without a Suspense boundary — wrap slower child regions in <Suspense> so React can stream available content",
      });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkAsyncComponent(node, node.body, node.async);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        const init = node.init;
        if (
          !isNodeOfType(init, "ArrowFunctionExpression") &&
          !isNodeOfType(init, "FunctionExpression")
        ) {
          return;
        }
        checkAsyncComponent(init, init.body, init.async);
      },
    };
  },
});
