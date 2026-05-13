import type { EsTreeNode, Rule, RuleContext } from "../types.js";
import { defineRule } from "../utils/define-rule.js";
import { isComponentAssignment, isUppercaseName } from "../helpers.js";
import { lowerFunction } from "./lower.js";
import { inferTypes } from "./infer-types.js";
import { validateNoSetStateInEffects } from "./validators/validate-no-set-state-in-effect.js";
import { validateNoDerivedComputationsInEffects } from "./validators/validate-no-derived-computations-in-effects.js";
import type { HIRFunction, Place } from "./types.js";

// HACK: per-component HIR cache so multiple HIR rules visiting the
// same file lower it once.
const lowerCache = new WeakMap<EsTreeNode, HIRFunction>();

const getOrLowerHir = (componentNode: EsTreeNode): HIRFunction => {
  const cached = lowerCache.get(componentNode);
  if (cached) return cached;
  const fn = lowerFunction(componentNode);
  inferTypes(fn);
  lowerCache.set(componentNode, fn);
  return fn;
};

const resolveReportNode = (place: Place, fallbackNode: EsTreeNode): EsTreeNode =>
  place.originNode ?? fallbackNode;

export const hirNoSetStateInEffect = defineRule<Rule>({
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
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        visitComponent(node);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        if (!node.init) return;
        visitComponent(node.init);
      },
    };
  },
});

export const hirNoDerivedComputationsInEffects = defineRule<Rule>({
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
      FunctionDeclaration(node: EsTreeNode) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        visitComponent(node);
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        if (!node.init) return;
        visitComponent(node.init);
      },
    };
  },
});
