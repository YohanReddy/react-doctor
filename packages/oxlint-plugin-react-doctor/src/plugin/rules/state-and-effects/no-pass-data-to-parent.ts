import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getUpstreamRefs,
  isSynchronous,
} from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  findContainingNode,
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isConstant,
  isCustomHook,
  isProp,
  isPropCall,
  isRefCall,
  isRefCurrent,
  isUseEffect,
} from "./utils/effect/react.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// 1:1 port of upstream `src/rules/no-pass-data-to-parent.js`.

// Local mirror of upstream's inline `isUseState`/`isUseRef` checks
// that work on the *identifier* of an upstream ref (not on a ref).
const isUseStateIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useState") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useState"
  ) {
    return true;
  }
  return false;
};

const isUseRefIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useRef") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useRef"
  ) {
    return true;
  }
  return false;
};

export const noPassDataToParent = defineRule<Rule>({
  id: "no-pass-data-to-parent",
  severity: "warn",
  recommendation:
    "Fetch the data in the parent and pass it to the child as a prop (or return it from the hook), instead of pushing it back up via a prop callback inside a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#passing-data-to-the-parent",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      if (!effectFnRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      for (const ref of effectFnRefs) {
        if (!isPropCall(analysis, ref)) continue;
        if (isRefCall(analysis, ref)) continue;
        if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;

        const argsUpstreamRefs = getArgsUpstreamRefs(analysis, ref).filter(
          (argRef) => getUpstreamRefs(analysis, argRef).length === 1,
        );

        const isSomeArgsData = argsUpstreamRefs.some((argRef) => {
          if (isUseStateIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isProp(analysis, argRef)) return false;
          if (isUseRefIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
          if (isRefCurrent(argRef)) return false;
          if (isConstant(argRef)) return false;
          return true;
        });
        if (!isSomeArgsData) continue;

        const containing = findContainingNode(analysis, node);
        const isInCustomHook = containing != null && isCustomHook(containing);
        context.report({
          node: callExpr,
          message: isInCustomHook
            ? "Avoid passing data to parents in an effect. Instead, return the data from the hook."
            : "Avoid passing data to parents in an effect. Instead, fetch the data in the parent and pass it down to the child as a prop.",
        });
      }
    },
  }),
});
