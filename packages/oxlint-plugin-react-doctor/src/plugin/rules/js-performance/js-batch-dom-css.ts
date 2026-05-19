import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Style writes alone don't trigger reflow — the browser batches them.
// Layout thrashing happens when reads (`offsetHeight`, `getBoundingClientRect`,
// etc.) are interleaved with writes inside a loop. So sequential style
// writes outside a loop body are harmless; only flag when we can prove
// we're inside a loop / `.forEach` / `.map` body. Plus the typical "build
// a DOM element by setting a few style props" pattern (no loop) is the
// dominant FP source — it has no reflow cost at all.
const isInsideLoopContext = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return true;
    }
    if (
      isNodeOfType(current, "CallExpression") &&
      isNodeOfType(current.callee, "MemberExpression") &&
      isNodeOfType(current.callee.property, "Identifier")
    ) {
      const methodName = current.callee.property.name;
      if (
        methodName === "forEach" ||
        methodName === "map" ||
        methodName === "flatMap" ||
        methodName === "filter" ||
        methodName === "reduce" ||
        methodName === "reduceRight"
      ) {
        return true;
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

export const jsBatchDomCss = defineRule<Rule>({
  id: "js-batch-dom-css",
  severity: "warn",
  recommendation:
    "Batch DOM/CSS reads and writes — interleaving them inside a loop causes layout thrashing. Read first, then write",
  create: (context: RuleContext) => {
    const isStyleAssignment = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "ExpressionStatement") &&
      isNodeOfType(node.expression, "AssignmentExpression") &&
      isNodeOfType(node.expression.left, "MemberExpression") &&
      isNodeOfType(node.expression.left.object, "MemberExpression") &&
      isNodeOfType(node.expression.left.object.property, "Identifier") &&
      node.expression.left.object.property.name === "style";

    return {
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        if (!isInsideLoopContext(node)) return;
        const statements = node.body ?? [];
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            isStyleAssignment(statements[statementIndex]) &&
            isStyleAssignment(statements[statementIndex - 1])
          ) {
            context.report({
              node: statements[statementIndex],
              message:
                "Multiple sequential element.style assignments — batch with cssText or classList for fewer reflows",
            });
          }
        }
      },
    };
  },
});
