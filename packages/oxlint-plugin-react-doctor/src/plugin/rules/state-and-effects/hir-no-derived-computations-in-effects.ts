import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOrLowerHir, resolveReportNode } from "../../hir/runner.js";
import { validateNoDerivedComputationsInEffects } from "../../hir/validators/validate-no-derived-computations-in-effects.js";

export const hirNoDerivedComputationsInEffects = defineRule<Rule>({
  id: "hir-no-derived-computations-in-effects",
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "The effect captures only its declared dependencies (and setStates) — that means it's deriving state. Compute the value during render; if the derivation is expensive, wrap it in `useMemo`. (Detected via HIR data flow analysis.)",
  create: (context: RuleContext) => {
    const visitComponent = (functionNode: EsTreeNode): void => {
      const fn = getOrLowerHir(functionNode);
      const findings = validateNoDerivedComputationsInEffects(fn);
      for (const finding of findings) {
        const reportNode = resolveReportNode(finding.effectCallPlace, functionNode);
        context.report({
          node: reportNode,
          message:
            "Effect derives state purely from its dependencies — compute the value during render (or wrap in `useMemo` if expensive). (HIR-validated)",
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        visitComponent(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (!node.init) return;
        visitComponent(node.init);
      },
    };
  },
});
