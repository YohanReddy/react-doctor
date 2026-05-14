import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOrLowerHir, resolveReportNode } from "../../hir/runner.js";
import { validateNoSetStateInEffects } from "../../hir/validators/validate-no-set-state-in-effect.js";

export const hirNoSetStateInEffect = defineRule<Rule>({
  id: "hir-no-set-state-in-effect",
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Move the setState into the event that caused the change, or compute the value during render. setState inside an effect body triggers cascading renders. (Detected via HIR data flow analysis — the setState is propagated through assignments and useEffectEvent wrappers.)",
  create: (context: RuleContext) => {
    const visitComponent = (functionNode: EsTreeNode): void => {
      const fn = getOrLowerHir(functionNode);
      const findings = validateNoSetStateInEffects(fn);
      for (const finding of findings) {
        const reportNode = resolveReportNode(finding.callSitePlace, functionNode);
        const setterName = finding.setterPlace.identifier.name ?? "<setter>";
        context.report({
          node: reportNode,
          message: `Calling \`${setterName}()\` directly within an effect can trigger cascading renders. Effects should synchronize React with external systems; either move the setState into the event that caused it, or fold the value into a render-time derivation. (HIR-validated)`,
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
