import type { EsTreeNode } from "../types.js";
import type {
  BasicBlock,
  BlockId,
  EffectKind,
  HIR,
  HIRFunction,
  Identifier,
  IdentifierId,
  Instruction,
  InstructionId,
  InstructionValue,
  Place,
  ReactType,
  SourceLocation,
  Terminal,
} from "./types.js";

interface LoweringEnvironment {
  // HACK: id allocators are shared across all nested envs of one
  // lowering so a captured outer binding keeps its IdentifierId when
  // seen by an inner function.
  ids: { nextIdentifierId: number; nextInstructionId: number; nextSyntheticName: number };
  bindings: Map<string, Place>;
  parent: LoweringEnvironment | null;
  instructions: Array<Instruction>;
}

const ZERO_LOCATION: SourceLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
};

const getLocation = (node: EsTreeNode | null | undefined): SourceLocation => {
  if (!node?.loc) return ZERO_LOCATION;
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
};

const createRootEnvironment = (): LoweringEnvironment => ({
  ids: { nextIdentifierId: 0, nextInstructionId: 0, nextSyntheticName: 0 },
  bindings: new Map(),
  parent: null,
  instructions: [],
});

const createChildEnvironment = (parent: LoweringEnvironment): LoweringEnvironment => ({
  ids: parent.ids,
  bindings: new Map(),
  parent,
  instructions: [],
});

const allocateIdentifierId = (env: LoweringEnvironment): IdentifierId => env.ids.nextIdentifierId++;

const allocateInstructionId = (env: LoweringEnvironment): InstructionId =>
  env.ids.nextInstructionId++;

const allocateSyntheticName = (env: LoweringEnvironment): string =>
  `$tmp${env.ids.nextSyntheticName++}`;

const createIdentifier = (
  env: LoweringEnvironment,
  name: string | null,
  origin: Identifier["origin"],
  type: ReactType = "Unknown",
): Identifier => ({
  id: allocateIdentifierId(env),
  name,
  type,
  origin,
});

const createPlace = (
  identifier: Identifier,
  loc: SourceLocation,
  effect: EffectKind = "Read",
  originNode: EsTreeNode | null = null,
): Place => ({ identifier, effect, loc, originNode });

const emitInstruction = (
  env: LoweringEnvironment,
  lvalue: Place | null,
  value: InstructionValue,
  loc: SourceLocation,
): void => {
  env.instructions.push({
    id: allocateInstructionId(env),
    lvalue,
    value,
    loc,
  });
};

const emitTemporary = (
  env: LoweringEnvironment,
  value: InstructionValue,
  loc: SourceLocation,
  originNode: EsTreeNode | null = null,
): Place => {
  const identifier = createIdentifier(env, allocateSyntheticName(env), "synthetic");
  const place = createPlace(identifier, loc, "Read", originNode);
  emitInstruction(env, place, value, loc);
  return place;
};

const lookupBinding = (env: LoweringEnvironment, name: string): Place | null => {
  // Walk parent chain so a closure can resolve a name to the outer
  // function's Place (sharing IdentifierIds), the way the compiler's
  // `findContextIdentifiers` exposes captured bindings.
  let cursor: LoweringEnvironment | null = env;
  while (cursor) {
    const place = cursor.bindings.get(name);
    if (place) return place;
    cursor = cursor.parent;
  }
  return null;
};

const setBinding = (env: LoweringEnvironment, name: string, place: Place): void => {
  env.bindings.set(name, place);
};

const PROP_CALLBACK_NAME_PATTERN = /^on[A-Z]/;

const isPropCallbackName = (name: string): boolean => PROP_CALLBACK_NAME_PATTERN.test(name);

const collectDestructuredProps = (
  env: LoweringEnvironment,
  pattern: EsTreeNode | undefined,
  destructuredProps: Map<string, Place>,
): void => {
  if (!pattern || pattern.type !== "ObjectPattern") return;
  for (const property of pattern.properties ?? []) {
    if (property.type !== "Property") continue;
    if (property.value?.type !== "Identifier") continue;
    const propName: string = property.value.name;
    const reactType: ReactType = isPropCallbackName(propName) ? "PropCallback" : "Unknown";
    const identifier = createIdentifier(env, propName, "destructured-prop", reactType);
    const place = createPlace(identifier, getLocation(property), "Read", property.value);
    destructuredProps.set(propName, place);
    setBinding(env, propName, place);
  }
};

const collectFunctionParams = (
  env: LoweringEnvironment,
  paramNodes: Array<EsTreeNode> | undefined,
  destructuredProps: Map<string, Place>,
): Array<Place> => {
  const places: Array<Place> = [];
  for (const param of paramNodes ?? []) {
    if (param.type === "Identifier") {
      const identifier = createIdentifier(env, param.name, "param");
      const place = createPlace(identifier, getLocation(param), "Read", param);
      places.push(place);
      setBinding(env, param.name, place);
      continue;
    }
    if (param.type === "ObjectPattern") {
      const identifier = createIdentifier(env, "props", "param");
      const place = createPlace(identifier, getLocation(param), "Read", param);
      places.push(place);
      collectDestructuredProps(env, param, destructuredProps);
    }
  }
  return places;
};

// HACK: SpreadElement (`f(...args)`) isn't a real expression node in
// ESTree, so unwrap to its `argument` to keep operand identity.
const lowerCallArguments = (
  env: LoweringEnvironment,
  argumentNodes: Array<EsTreeNode> | undefined,
): Array<Place> =>
  (argumentNodes ?? []).map((argumentNode: EsTreeNode) => {
    if (argumentNode.type === "SpreadElement") {
      return lowerExpression(env, argumentNode.argument);
    }
    return lowerExpression(env, argumentNode);
  });

const lowerExpression = (env: LoweringEnvironment, node: EsTreeNode | null | undefined): Place => {
  if (!node) {
    return emitTemporary(env, { kind: "Unsupported", reason: "missing-node" }, ZERO_LOCATION, null);
  }
  const loc = getLocation(node);

  if (node.type === "Identifier") {
    const existing = lookupBinding(env, node.name);
    if (existing) {
      return emitTemporary(env, { kind: "LoadLocal", place: existing }, loc, node);
    }
    const identifier = createIdentifier(env, node.name, "module");
    const place = createPlace(identifier, loc, "Read", node);
    return emitTemporary(env, { kind: "LoadGlobal", name: node.name, place }, loc, node);
  }

  if (node.type === "Literal") {
    return emitTemporary(
      env,
      { kind: "Literal", value: node.value, raw: String(node.raw ?? "") },
      loc,
      node,
    );
  }

  if (node.type === "TemplateLiteral") {
    const expressions: Array<Place> = [];
    for (const expression of node.expressions ?? []) {
      expressions.push(lowerExpression(env, expression));
    }
    return emitTemporary(
      env,
      {
        kind: "Literal",
        value: null,
        raw: `\`...${expressions.length} interpolations...\``,
      },
      loc,
      node,
    );
  }

  if (node.type === "MemberExpression") {
    const objectPlace = lowerExpression(env, node.object);
    if (!node.computed && node.property?.type === "Identifier") {
      return emitTemporary(
        env,
        {
          kind: "PropertyLoad",
          object: objectPlace,
          property: node.property.name,
          computed: false,
        },
        loc,
        node,
      );
    }
    if (node.computed) {
      const propertyPlace = lowerExpression(env, node.property);
      return emitTemporary(
        env,
        {
          kind: "PropertyLoad",
          object: objectPlace,
          property: propertyPlace.identifier.name ?? `[computed:${propertyPlace.identifier.id}]`,
          computed: true,
        },
        loc,
        node,
      );
    }
    return emitTemporary(env, { kind: "Unsupported", reason: "member-expression" }, loc, node);
  }

  if (node.type === "CallExpression") {
    if (node.callee?.type === "MemberExpression" && !node.callee.computed) {
      const receiverPlace = lowerExpression(env, node.callee.object);
      const propertyName =
        node.callee.property?.type === "Identifier" ? node.callee.property.name : "<computed>";
      const propertyPlace = createPlace(
        createIdentifier(env, propertyName, "synthetic"),
        getLocation(node.callee.property),
        "Read",
        node.callee.property,
      );
      const args = lowerCallArguments(env, node.arguments);
      return emitTemporary(
        env,
        {
          kind: "MethodCall",
          receiver: receiverPlace,
          property: propertyPlace,
          propertyName,
          args,
        },
        loc,
        node,
      );
    }
    const calleePlace = lowerExpression(env, node.callee);
    const args = lowerCallArguments(env, node.arguments);
    return emitTemporary(env, { kind: "CallExpression", callee: calleePlace, args }, loc, node);
  }

  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) {
    const lowered = lowerFunctionInEnv(node, env);
    const capturedPlaces: Array<Place> = collectCapturedPlaces(lowered);
    const place = emitTemporary(
      env,
      {
        kind: "FunctionExpression",
        loweredFunc: lowered,
        capturedPlaces,
      },
      loc,
      node,
    );
    // HACK: nested `function helper() {}` declares `helper` in the
    // enclosing scope; bind the name so call sites resolve to it.
    if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") {
      setBinding(env, node.id.name, place);
    }
    return place;
  }

  if (node.type === "ArrayExpression") {
    const elements: Array<Place | null> = (node.elements ?? []).map((element: EsTreeNode | null) =>
      element ? lowerExpression(env, element) : null,
    );
    return emitTemporary(env, { kind: "ArrayExpression", elements }, loc, node);
  }

  if (node.type === "ObjectExpression") {
    const properties: Array<{ key: string | null; value: Place; spread: boolean }> = [];
    for (const property of node.properties ?? []) {
      if (property.type === "SpreadElement") {
        properties.push({
          key: null,
          value: lowerExpression(env, property.argument),
          spread: true,
        });
        continue;
      }
      if (property.type === "Property") {
        const keyName =
          property.key?.type === "Identifier"
            ? property.key.name
            : property.key?.type === "Literal"
              ? String(property.key.value)
              : null;
        properties.push({
          key: keyName,
          value: lowerExpression(env, property.value),
          spread: false,
        });
      }
    }
    return emitTemporary(env, { kind: "ObjectExpression", properties }, loc, node);
  }

  if (node.type === "BinaryExpression") {
    const left = lowerExpression(env, node.left);
    const right = lowerExpression(env, node.right);
    return emitTemporary(
      env,
      { kind: "BinaryExpression", left, operator: node.operator, right },
      loc,
      node,
    );
  }

  if (node.type === "LogicalExpression") {
    const left = lowerExpression(env, node.left);
    const right = lowerExpression(env, node.right);
    return emitTemporary(
      env,
      { kind: "LogicalExpression", left, operator: node.operator, right },
      loc,
      node,
    );
  }

  if (node.type === "UnaryExpression") {
    const argument = lowerExpression(env, node.argument);
    return emitTemporary(
      env,
      { kind: "UnaryExpression", operator: node.operator, argument },
      loc,
      node,
    );
  }

  if (node.type === "ConditionalExpression") {
    const test = lowerExpression(env, node.test);
    const consequent = lowerExpression(env, node.consequent);
    const alternate = lowerExpression(env, node.alternate);
    return emitTemporary(
      env,
      { kind: "ConditionalExpression", test, consequent, alternate },
      loc,
      node,
    );
  }

  if (node.type === "JSXElement" || node.type === "JSXFragment") {
    const placeholder = emitTemporary(
      env,
      { kind: "Literal", value: "<jsx>", raw: "<jsx>" },
      loc,
      node,
    );
    return emitTemporary(env, { kind: "JSXExpression", jsxPlaceholder: placeholder }, loc, node);
  }

  return emitTemporary(env, { kind: "Unsupported", reason: node.type }, loc, node);
};

// HACK: a "capture" is any LoadLocal whose source Identifier wasn't
// declared inside the inner function (params, destructured props,
// instruction lvalues). Shared id allocator means the captured Place
// is already === the outer Place.
const collectCapturedPlaces = (innerFn: HIRFunction): Array<Place> => {
  const captured: Array<Place> = [];
  const seenIds = new Set<IdentifierId>();
  const innerOwnIds = new Set<IdentifierId>();
  for (const param of innerFn.params) innerOwnIds.add(param.identifier.id);
  for (const place of innerFn.destructuredProps.values()) {
    innerOwnIds.add(place.identifier.id);
  }
  for (const block of innerFn.body.blocks.values()) {
    for (const instr of block.instructions) {
      if (instr.lvalue) innerOwnIds.add(instr.lvalue.identifier.id);
    }
  }
  for (const block of innerFn.body.blocks.values()) {
    for (const instr of block.instructions) {
      if (instr.value.kind !== "LoadLocal") continue;
      const place = instr.value.place;
      if (innerOwnIds.has(place.identifier.id)) continue;
      if (seenIds.has(place.identifier.id)) continue;
      seenIds.add(place.identifier.id);
      captured.push(place);
    }
  }
  return captured;
};

const lowerVariableDeclaration = (env: LoweringEnvironment, node: EsTreeNode): void => {
  for (const declarator of node.declarations ?? []) {
    if (!declarator) continue;
    const initPlace = declarator.init ? lowerExpression(env, declarator.init) : null;

    if (declarator.id?.type === "Identifier") {
      const name = declarator.id.name;
      const identifier = createIdentifier(env, name, "local");
      const lvalue = createPlace(identifier, getLocation(declarator.id), "Read", declarator.id);
      if (initPlace) {
        emitInstruction(
          env,
          lvalue,
          { kind: "StoreLocal", lvalue, value: initPlace },
          getLocation(declarator),
        );
      }
      setBinding(env, name, lvalue);
      continue;
    }

    if (declarator.id?.type === "ArrayPattern" && initPlace) {
      const elements = declarator.id.elements ?? [];
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        const element = elements[elementIndex];
        if (!element || element.type !== "Identifier") continue;
        const name: string = element.name;
        const identifier = createIdentifier(env, name, "local");
        const lvalue = createPlace(identifier, getLocation(element), "Read", element);
        emitInstruction(
          env,
          lvalue,
          {
            kind: "PropertyLoad",
            object: initPlace,
            property: String(elementIndex),
            computed: true,
          },
          getLocation(element),
        );
        setBinding(env, name, lvalue);
      }
    }
  }
};

const lowerStatement = (env: LoweringEnvironment, node: EsTreeNode | null | undefined): void => {
  if (!node) return;

  if (node.type === "VariableDeclaration") {
    lowerVariableDeclaration(env, node);
    return;
  }

  if (node.type === "ExpressionStatement") {
    lowerExpression(env, node.expression);
    return;
  }

  if (node.type === "ReturnStatement") {
    if (node.argument) lowerExpression(env, node.argument);
    return;
  }

  if (node.type === "BlockStatement") {
    for (const child of node.body ?? []) lowerStatement(env, child);
    return;
  }

  if (node.type === "IfStatement") {
    lowerExpression(env, node.test);
    lowerStatement(env, node.consequent);
    if (node.alternate) lowerStatement(env, node.alternate);
    return;
  }

  // HACK: control-flow statements collapse into the surrounding block
  // for v1 (no CFG terminals modeled). We recurse into their bodies
  // so hooks/effects inside them still get lowered.
  if (node.type === "ForStatement" || node.type === "WhileStatement") {
    if (node.test) lowerExpression(env, node.test);
    if (node.update) lowerExpression(env, node.update);
    if (node.init) {
      if (node.init.type === "VariableDeclaration") {
        lowerVariableDeclaration(env, node.init);
      } else {
        lowerExpression(env, node.init);
      }
    }
    lowerStatement(env, node.body);
    return;
  }

  if (node.type === "DoWhileStatement") {
    lowerStatement(env, node.body);
    if (node.test) lowerExpression(env, node.test);
    return;
  }

  if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
    if (node.left?.type === "VariableDeclaration") {
      lowerVariableDeclaration(env, node.left);
    }
    if (node.right) lowerExpression(env, node.right);
    lowerStatement(env, node.body);
    return;
  }

  if (node.type === "SwitchStatement") {
    if (node.discriminant) lowerExpression(env, node.discriminant);
    for (const switchCase of node.cases ?? []) {
      if (switchCase.test) lowerExpression(env, switchCase.test);
      for (const consequentStatement of switchCase.consequent ?? []) {
        lowerStatement(env, consequentStatement);
      }
    }
    return;
  }

  if (node.type === "TryStatement") {
    lowerStatement(env, node.block);
    if (node.handler) {
      // HACK: bind catch param so references inside the handler body
      // resolve as LoadLocal, not LoadGlobal.
      if (node.handler.param?.type === "Identifier") {
        const paramName = node.handler.param.name;
        const paramIdentifier = createIdentifier(env, paramName, "local");
        const paramPlace = createPlace(
          paramIdentifier,
          getLocation(node.handler.param),
          "Read",
          node.handler.param,
        );
        setBinding(env, paramName, paramPlace);
      }
      if (node.handler.body) lowerStatement(env, node.handler.body);
    }
    if (node.finalizer) lowerStatement(env, node.finalizer);
    return;
  }

  if (node.type === "ThrowStatement") {
    if (node.argument) lowerExpression(env, node.argument);
    return;
  }

  if (node.type === "LabeledStatement") {
    lowerStatement(env, node.body);
    return;
  }

  if (
    node.type === "FunctionDeclaration" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  ) {
    lowerExpression(env, node);
    return;
  }
};

const lowerFunctionInEnv = (
  functionNode: EsTreeNode,
  parentEnv: LoweringEnvironment | null,
): HIRFunction => {
  const env = parentEnv ? createChildEnvironment(parentEnv) : createRootEnvironment();
  const destructuredProps = new Map<string, Place>();
  const params = collectFunctionParams(env, functionNode.params, destructuredProps);

  const body = functionNode.body;
  if (body) {
    if (body.type === "BlockStatement") {
      for (const statement of body.body ?? []) lowerStatement(env, statement);
    } else {
      lowerExpression(env, body);
    }
  }

  const entryBlockId: BlockId = "bb0";
  const terminal: Terminal = {
    kind: "return",
    value: null,
    id: allocateInstructionId(env),
    loc: getLocation(functionNode),
  };
  const entryBlock: BasicBlock = {
    id: entryBlockId,
    instructions: env.instructions,
    terminal,
    preds: new Set(),
  };

  const blocks = new Map<BlockId, BasicBlock>();
  blocks.set(entryBlockId, entryBlock);

  const hir: HIR = { entry: entryBlockId, blocks };

  return {
    name: functionNode.id?.name ?? null,
    params,
    destructuredProps,
    body: hir,
  };
};

export const lowerFunction = (functionNode: EsTreeNode): HIRFunction =>
  lowerFunctionInEnv(functionNode, null);
