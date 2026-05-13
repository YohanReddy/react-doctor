import type { EsTreeNode } from "../types.js";

export type IdentifierId = number;
export type InstructionId = number;
export type BlockId = string;

export type ReactType =
  | "Unknown"
  | "Primitive"
  | "Function"
  | "Object"
  | "UseStateHook"
  | "UseEffectHook"
  | "UseLayoutEffectHook"
  | "UseRefHook"
  | "UseCallbackHook"
  | "UseMemoHook"
  | "UseContextHook"
  | "UseEffectEventHook"
  // HACK: tuple returned by useState/useReducer. Kept distinct from
  // `Object` so the indexed-PropertyLoad branch (StateValue /
  // StateSetter) doesn't fire on useMemo destructures.
  | "StateTuple"
  | "StateValue"
  | "StateSetter"
  | "RefValue"
  | "RefCurrent"
  | "EffectEvent"
  | "PropCallback";

export type EffectKind = "Read" | "Unknown";

export interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface Identifier {
  id: IdentifierId;
  name: string | null;
  type: ReactType;
  origin: "module" | "destructured-prop" | "param" | "local" | "synthetic";
}

export interface Place {
  identifier: Identifier;
  effect: EffectKind;
  loc: SourceLocation;
  originNode: EsTreeNode | null;
}

export type InstructionValue =
  | { kind: "LoadLocal"; place: Place }
  | { kind: "LoadGlobal"; name: string; place: Place }
  | { kind: "StoreLocal"; lvalue: Place; value: Place }
  | { kind: "CallExpression"; callee: Place; args: Array<Place> }
  | {
      kind: "MethodCall";
      receiver: Place;
      property: Place;
      propertyName: string;
      args: Array<Place>;
    }
  | { kind: "PropertyLoad"; object: Place; property: string; computed: boolean }
  | { kind: "FunctionExpression"; loweredFunc: HIRFunction; capturedPlaces: Array<Place> }
  | { kind: "ArrayExpression"; elements: Array<Place | null> }
  | {
      kind: "ObjectExpression";
      properties: Array<{ key: string | null; value: Place; spread: boolean }>;
    }
  | { kind: "Literal"; value: unknown; raw: string }
  | { kind: "Identifier"; place: Place }
  | { kind: "BinaryExpression"; left: Place; operator: string; right: Place }
  | { kind: "LogicalExpression"; left: Place; operator: string; right: Place }
  | { kind: "UnaryExpression"; operator: string; argument: Place }
  | { kind: "ConditionalExpression"; test: Place; consequent: Place; alternate: Place }
  | { kind: "JSXExpression"; jsxPlaceholder: Place }
  | { kind: "Unsupported"; reason: string };

export type Terminal =
  | { kind: "return"; value: Place | null; id: InstructionId; loc: SourceLocation }
  | { kind: "unsupported"; reason: string; id: InstructionId; loc: SourceLocation };

export interface Instruction {
  id: InstructionId;
  lvalue: Place | null;
  value: InstructionValue;
  loc: SourceLocation;
}

export interface BasicBlock {
  id: BlockId;
  instructions: Array<Instruction>;
  terminal: Terminal;
  preds: Set<BlockId>;
}

export interface HIRFunction {
  name: string | null;
  params: Array<Place>;
  destructuredProps: Map<string, Place>;
  body: HIR;
}

export interface HIR {
  entry: BlockId;
  blocks: Map<BlockId, BasicBlock>;
}

export const isSetStateType = (identifier: Identifier): boolean =>
  identifier.type === "StateSetter";

export const isUseEffectHookType = (identifier: Identifier): boolean =>
  identifier.type === "UseEffectHook" || identifier.type === "UseLayoutEffectHook";

export const isUseEffectEventType = (identifier: Identifier): boolean =>
  identifier.type === "UseEffectEventHook";
