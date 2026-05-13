import {
  type HIRFunction,
  type IdentifierId,
  type Place,
  isSetStateType,
  isUseEffectEventType,
  isUseEffectHookType,
} from "../types.js";

// HACK: port of `babel-plugin-react-compiler/src/Validation/ValidateNoSetStateInEffects.ts`.
// Tracks IdentifierIds that resolve back to a state setter through
// LoadLocal / StoreLocal / FunctionExpression / useEffectEvent, then
// reports each useEffect whose callback id is in that set.

export interface SetStateInEffectFinding {
  setterPlace: Place;
  callSitePlace: Place;
  effectCallPlace: Place;
}

interface InnerSetStateMatch {
  setterPlace: Place;
  callSitePlace: Place;
}

export const validateNoSetStateInEffects = (fn: HIRFunction): Array<SetStateInEffectFinding> => {
  const findings: Array<SetStateInEffectFinding> = [];

  const setStateBindings = new Map<IdentifierId, Place>();
  // Parallel map: id → call-site Place inside the effect body. Used
  // so the diagnostic anchors at `setX(...)` not the setter decl.
  const innerCallSites = new Map<IdentifierId, Place>();

  for (const block of fn.body.blocks.values()) {
    for (const instr of block.instructions) {
      switch (instr.value.kind) {
        case "LoadLocal": {
          const sourceId = instr.value.place.identifier.id;
          if (isSetStateType(instr.value.place.identifier) || setStateBindings.has(sourceId)) {
            const originPlace = setStateBindings.get(sourceId) ?? instr.value.place;
            if (instr.lvalue) {
              setStateBindings.set(instr.lvalue.identifier.id, originPlace);
              const callSite = innerCallSites.get(sourceId);
              if (callSite) innerCallSites.set(instr.lvalue.identifier.id, callSite);
            }
          }
          break;
        }

        case "StoreLocal": {
          const sourceId = instr.value.value.identifier.id;
          if (isSetStateType(instr.value.value.identifier) || setStateBindings.has(sourceId)) {
            const originPlace = setStateBindings.get(sourceId) ?? instr.value.value;
            setStateBindings.set(instr.value.lvalue.identifier.id, originPlace);
            if (instr.lvalue) setStateBindings.set(instr.lvalue.identifier.id, originPlace);
            const callSite = innerCallSites.get(sourceId);
            if (callSite) {
              innerCallSites.set(instr.value.lvalue.identifier.id, callSite);
              if (instr.lvalue) innerCallSites.set(instr.lvalue.identifier.id, callSite);
            }
          }
          break;
        }

        case "FunctionExpression": {
          const innerMatch = findTopLevelSetStateCall(instr.value.loweredFunc, setStateBindings);
          if (innerMatch && instr.lvalue) {
            setStateBindings.set(instr.lvalue.identifier.id, innerMatch.setterPlace);
            innerCallSites.set(instr.lvalue.identifier.id, innerMatch.callSitePlace);
          }
          break;
        }

        case "CallExpression": {
          const callee = instr.value.callee;

          if (isUseEffectEventType(callee.identifier)) {
            const firstArgument = instr.value.args[0];
            if (firstArgument) {
              const originPlace = setStateBindings.get(firstArgument.identifier.id);
              if (originPlace && instr.lvalue) {
                setStateBindings.set(instr.lvalue.identifier.id, originPlace);
                const callSite = innerCallSites.get(firstArgument.identifier.id);
                if (callSite) innerCallSites.set(instr.lvalue.identifier.id, callSite);
              }
            }
            break;
          }

          if (isUseEffectHookType(callee.identifier)) {
            const callbackArgument = instr.value.args[0];
            if (callbackArgument) {
              const setterOrigin = setStateBindings.get(callbackArgument.identifier.id);
              if (setterOrigin) {
                const callSite =
                  innerCallSites.get(callbackArgument.identifier.id) ?? callbackArgument;
                findings.push({
                  setterPlace: setterOrigin,
                  callSitePlace: callSite,
                  effectCallPlace: callee,
                });
              }
            }
          }
          break;
        }

        case "MethodCall":
        case "PropertyLoad":
        case "ArrayExpression":
        case "ObjectExpression":
        case "Literal":
        case "LoadGlobal":
        case "Identifier":
        case "BinaryExpression":
        case "LogicalExpression":
        case "UnaryExpression":
        case "ConditionalExpression":
        case "JSXExpression":
        case "Unsupported":
          break;
      }
    }
  }

  return findings;
};

// Walk an inner HIRFunction and return the setter + call-site if it
// synchronously calls a setState at the top level. Mirrors upstream
// `getSetStateCall` without the ref-derived exception.
const findTopLevelSetStateCall = (
  fn: HIRFunction,
  outerSetStateBindings: Map<IdentifierId, Place>,
): InnerSetStateMatch | null => {
  const innerSetStateBindings = new Map<IdentifierId, Place>(outerSetStateBindings);

  for (const block of fn.body.blocks.values()) {
    for (const instr of block.instructions) {
      switch (instr.value.kind) {
        case "LoadLocal": {
          const sourceId = instr.value.place.identifier.id;
          if (isSetStateType(instr.value.place.identifier) || innerSetStateBindings.has(sourceId)) {
            const originPlace = innerSetStateBindings.get(sourceId) ?? instr.value.place;
            if (instr.lvalue) {
              innerSetStateBindings.set(instr.lvalue.identifier.id, originPlace);
            }
          }
          break;
        }
        case "StoreLocal": {
          const sourceId = instr.value.value.identifier.id;
          if (isSetStateType(instr.value.value.identifier) || innerSetStateBindings.has(sourceId)) {
            const originPlace = innerSetStateBindings.get(sourceId) ?? instr.value.value;
            innerSetStateBindings.set(instr.value.lvalue.identifier.id, originPlace);
            if (instr.lvalue) {
              innerSetStateBindings.set(instr.lvalue.identifier.id, originPlace);
            }
          }
          break;
        }
        case "CallExpression": {
          const calleeIdentifier = instr.value.callee.identifier;
          if (isSetStateType(calleeIdentifier) || innerSetStateBindings.has(calleeIdentifier.id)) {
            const setterPlace =
              innerSetStateBindings.get(calleeIdentifier.id) ?? instr.value.callee;
            const callSitePlace = instr.lvalue ?? instr.value.callee;
            return { setterPlace, callSitePlace };
          }
          break;
        }
        case "FunctionExpression":
        case "MethodCall":
        case "PropertyLoad":
        case "ArrayExpression":
        case "ObjectExpression":
        case "Literal":
        case "LoadGlobal":
        case "Identifier":
        case "BinaryExpression":
        case "LogicalExpression":
        case "UnaryExpression":
        case "ConditionalExpression":
        case "JSXExpression":
        case "Unsupported":
          break;
      }
    }
  }

  return null;
};
