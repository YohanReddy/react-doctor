import type { HIRFunction, Identifier, ReactType } from "./types.js";

// HACK: pared-down `inferTypes` pass — recognizes React hook callees
// (LoadGlobal name match), propagates return types to call results,
// and threads types through LoadLocal / StoreLocal so aliased setters
// stay typed as `StateSetter`.

const REACT_HOOK_NAME_TO_TYPE: Record<string, ReactType> = {
  useState: "UseStateHook",
  useReducer: "UseStateHook",
  useEffect: "UseEffectHook",
  useLayoutEffect: "UseLayoutEffectHook",
  useInsertionEffect: "UseLayoutEffectHook",
  useRef: "UseRefHook",
  useCallback: "UseCallbackHook",
  useMemo: "UseMemoHook",
  useContext: "UseContextHook",
  useEffectEvent: "UseEffectEventHook",
};

const setIdentifierType = (identifier: Identifier, type: ReactType): void => {
  if (identifier.type === "Unknown" || identifier.type === "Function") {
    identifier.type = type;
  }
};

export const inferTypes = (fn: HIRFunction): void => {
  for (const block of fn.body.blocks.values()) {
    for (const instr of block.instructions) {
      const lvalue = instr.lvalue;

      switch (instr.value.kind) {
        case "LoadGlobal": {
          const reactType = REACT_HOOK_NAME_TO_TYPE[instr.value.name];
          if (reactType && lvalue) {
            setIdentifierType(lvalue.identifier, reactType);
            setIdentifierType(instr.value.place.identifier, reactType);
          }
          break;
        }
        case "LoadLocal": {
          if (lvalue) {
            setIdentifierType(lvalue.identifier, instr.value.place.identifier.type);
          }
          break;
        }
        case "StoreLocal": {
          setIdentifierType(instr.value.lvalue.identifier, instr.value.value.identifier.type);
          if (lvalue) {
            setIdentifierType(lvalue.identifier, instr.value.value.identifier.type);
          }
          break;
        }
        case "CallExpression": {
          const calleeType = instr.value.callee.identifier.type;
          if (lvalue) {
            if (calleeType === "UseStateHook") {
              setIdentifierType(lvalue.identifier, "StateTuple");
            } else if (calleeType === "UseRefHook") {
              setIdentifierType(lvalue.identifier, "RefValue");
            } else if (calleeType === "UseEffectEventHook") {
              setIdentifierType(lvalue.identifier, "EffectEvent");
            } else if (calleeType === "UseCallbackHook") {
              setIdentifierType(lvalue.identifier, "Function");
            } else if (calleeType === "UseMemoHook") {
              setIdentifierType(lvalue.identifier, "Object");
            } else if (calleeType === "UseContextHook") {
              setIdentifierType(lvalue.identifier, "Object");
            }
          }
          break;
        }
        case "PropertyLoad": {
          const objectType = instr.value.object.identifier.type;
          if (objectType === "StateTuple" && instr.value.computed) {
            if (instr.value.property === "0" && lvalue) {
              setIdentifierType(lvalue.identifier, "StateValue");
            } else if (instr.value.property === "1" && lvalue) {
              setIdentifierType(lvalue.identifier, "StateSetter");
            }
          }
          if (
            objectType === "RefValue" &&
            !instr.value.computed &&
            instr.value.property === "current" &&
            lvalue
          ) {
            setIdentifierType(lvalue.identifier, "RefCurrent");
          }
          break;
        }
        case "MethodCall":
        case "ArrayExpression":
        case "ObjectExpression":
        case "Literal":
        case "Identifier":
        case "BinaryExpression":
        case "LogicalExpression":
        case "UnaryExpression":
        case "ConditionalExpression":
        case "FunctionExpression":
        case "JSXExpression":
        case "Unsupported":
          break;
      }
    }
  }
};
