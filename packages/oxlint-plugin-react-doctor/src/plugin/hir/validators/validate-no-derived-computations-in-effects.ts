import {
  type HIRFunction,
  type IdentifierId,
  type Place,
  isSetStateType,
  isUseEffectHookType,
} from "../types.js";

// HACK: port of `babel-plugin-react-compiler/src/Validation/ValidateNoDerivedComputationsInEffects.ts`.
// Reports when a useEffect's inner function captures only deps + state
// setters AND has at least one intermediate local binding (the
// AST-walker `noDerivedStateEffect` already covers the simple case).

export interface DerivedComputationInEffectFinding {
  effectCallPlace: Place;
}

interface EffectFunctionEntry {
  func: HIRFunction;
  captures: Array<Place>;
}

export const validateNoDerivedComputationsInEffects = (
  fn: HIRFunction,
): Array<DerivedComputationInEffectFinding> => {
  const findings: Array<DerivedComputationInEffectFinding> = [];

  const candidateDependencies = new Map<IdentifierId, Array<Place>>();
  const effectFunctions = new Map<IdentifierId, EffectFunctionEntry>();
  const localAliases = new Map<IdentifierId, IdentifierId>();

  for (const block of fn.body.blocks.values()) {
    for (const instr of block.instructions) {
      const lvalueId = instr.lvalue?.identifier.id;

      if (instr.value.kind === "LoadLocal" && lvalueId !== undefined) {
        localAliases.set(lvalueId, instr.value.place.identifier.id);
        continue;
      }

      if (instr.value.kind === "ArrayExpression" && lvalueId !== undefined) {
        const elementPlaces: Array<Place> = [];
        for (const element of instr.value.elements) {
          if (element) elementPlaces.push(element);
        }
        candidateDependencies.set(lvalueId, elementPlaces);
        continue;
      }

      if (instr.value.kind === "FunctionExpression" && lvalueId !== undefined) {
        effectFunctions.set(lvalueId, {
          func: instr.value.loweredFunc,
          captures: instr.value.capturedPlaces,
        });
        continue;
      }

      if (instr.value.kind === "CallExpression" || instr.value.kind === "MethodCall") {
        const callee =
          instr.value.kind === "CallExpression" ? instr.value.callee : instr.value.property;
        if (!isUseEffectHookType(callee.identifier)) continue;
        if (instr.value.args.length !== 2) continue;
        const callbackArgument = instr.value.args[0];
        const depsArgument = instr.value.args[1];
        const effectEntry = effectFunctions.get(callbackArgument.identifier.id);
        const depsList = candidateDependencies.get(depsArgument.identifier.id);
        if (!effectEntry || !depsList || depsList.length === 0) continue;

        const dependencyIds = depsList.map(
          (dep) => localAliases.get(dep.identifier.id) ?? dep.identifier.id,
        );

        const finding = validateEffect(effectEntry, dependencyIds, callee);
        if (finding) findings.push(finding);
      }
    }
  }

  return findings;
};

const validateEffect = (
  effectEntry: EffectFunctionEntry,
  effectDependencyIds: Array<IdentifierId>,
  effectCallPlace: Place,
): DerivedComputationInEffectFinding | null => {
  const capturedIds = new Set<IdentifierId>();
  for (const capture of effectEntry.captures) {
    capturedIds.add(capture.identifier.id);
    if (isSetStateType(capture.identifier) || effectDependencyIds.includes(capture.identifier.id)) {
      continue;
    }
    return null;
  }

  for (const dependencyId of effectDependencyIds) {
    if (!capturedIds.has(dependencyId)) return null;
  }

  // HACK: defer to AST-walker `noDerivedStateEffect` on the simple
  // single-setter-call shape; HIR rule's unique value is the
  // multi-statement-with-locals shape, which produces a StoreLocal.
  for (const block of effectEntry.func.body.blocks.values()) {
    for (const instr of block.instructions) {
      if (instr.value.kind === "StoreLocal") return { effectCallPlace };
    }
  }
  return null;
};
