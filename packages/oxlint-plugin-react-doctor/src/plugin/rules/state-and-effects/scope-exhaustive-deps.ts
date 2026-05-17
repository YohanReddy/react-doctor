import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Scope, ScopeReference, ScopeVariable } from "../../utils/scope-types.js";

interface DeclaredDependency {
  key: string;
  node: EsTreeNode;
}

interface Dependency {
  isStable: boolean;
  references: ScopeReference[];
}

interface DependencyTreeNode {
  isUsed: boolean;
  isSatisfiedRecursively: boolean;
  isSubtreeUsed: boolean;
  children: Map<string, DependencyTreeNode>;
}

const nodeRecord = (node: EsTreeNode): Record<string, unknown> =>
  node as unknown as Record<string, unknown>;

const getNodeWithoutReactNamespace = (node: EsTreeNode): EsTreeNode => {
  const rec = nodeRecord(node);
  if (
    node.type === "MemberExpression" &&
    rec.object &&
    (rec.object as EsTreeNode).type === "Identifier" &&
    nodeRecord(rec.object as EsTreeNode).name === "React" &&
    rec.property &&
    (rec.property as EsTreeNode).type === "Identifier" &&
    !rec.computed
  ) {
    return rec.property as EsTreeNode;
  }
  return node;
};

const getReactiveHookCallbackIndex = (calleeNode: EsTreeNode): number => {
  const node = getNodeWithoutReactNamespace(calleeNode);
  if (node.type !== "Identifier") return -1;
  const name = nodeRecord(node).name as string;
  switch (name) {
    case "useEffect":
    case "useLayoutEffect":
    case "useCallback":
    case "useMemo":
      return 0;
    case "useImperativeHandle":
      return 1;
    default:
      return -1;
  }
};

const nodeType = (node: EsTreeNode): string => node.type;

const analyzePropertyChain = (node: EsTreeNode): string => {
  const rec = nodeRecord(node);
  const type = nodeType(node);
  if (type === "Identifier" || type === "JSXIdentifier") {
    return rec.name as string;
  }
  if ((type === "MemberExpression" || type === "OptionalMemberExpression") && !rec.computed) {
    const objectStr = analyzePropertyChain(rec.object as EsTreeNode);
    const propertyStr = analyzePropertyChain(rec.property as EsTreeNode);
    return `${objectStr}.${propertyStr}`;
  }
  if (type === "ChainExpression") {
    const expression = rec.expression as EsTreeNode;
    const exprRec = nodeRecord(expression);
    const objectStr = analyzePropertyChain(exprRec.object as EsTreeNode);
    const propertyStr = analyzePropertyChain(exprRec.property as EsTreeNode);
    return `${objectStr}.${propertyStr}`;
  }
  throw new Error(`Unsupported node type: ${type}`);
};

const getDependency = (node: EsTreeNode): EsTreeNode => {
  const rec = nodeRecord(node);
  const parentNode = node.parent;
  if (!parentNode) return node;
  const parentRec = nodeRecord(parentNode);
  const parentType = nodeType(parentNode);

  if (
    (parentType === "MemberExpression" || parentType === "OptionalMemberExpression") &&
    parentRec.object === node &&
    (parentRec.property as EsTreeNode)?.type === "Identifier" &&
    nodeRecord(parentRec.property as EsTreeNode).name !== "current" &&
    !parentRec.computed
  ) {
    const grandparent = parentNode.parent;
    if (
      grandparent &&
      (nodeType(grandparent) === "CallExpression" ||
        nodeType(grandparent) === "OptionalCallExpression") &&
      nodeRecord(grandparent).callee === parentNode
    ) {
      return node;
    }
    return getDependency(parentNode);
  }

  if (
    nodeType(node) === "MemberExpression" &&
    parentType === "AssignmentExpression" &&
    parentRec.left === node
  ) {
    return rec.object as EsTreeNode;
  }

  return node;
};

const isNodeLike = (val: unknown): boolean =>
  typeof val === "object" &&
  val !== null &&
  !Array.isArray(val) &&
  "type" in val &&
  typeof (val as Record<string, unknown>).type === "string";

const isSameIdentifier = (a: EsTreeNode, b: EsTreeNode): boolean => {
  const aRec = nodeRecord(a);
  const bRec = nodeRecord(b);
  return (
    (a.type === "Identifier" || a.type === "JSXIdentifier") &&
    a.type === b.type &&
    aRec.name === bRec.name &&
    Boolean(aRec.range) &&
    Boolean(bRec.range) &&
    (aRec.range as number[])[0] === (bRec.range as number[])[0] &&
    (aRec.range as number[])[1] === (bRec.range as number[])[1]
  );
};

const isAncestorNodeOf = (a: EsTreeNode, b: EsTreeNode): boolean => {
  const aRec = nodeRecord(a);
  const bRec = nodeRecord(b);
  return (
    Boolean(aRec.range) &&
    Boolean(bRec.range) &&
    (aRec.range as number[])[0] <= (bRec.range as number[])[0] &&
    (aRec.range as number[])[1] >= (bRec.range as number[])[1]
  );
};

const fastFindReferenceWithParent = (start: EsTreeNode, target: EsTreeNode): EsTreeNode | null => {
  const queue: EsTreeNode[] = [start];

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (isSameIdentifier(item, target)) {
      return item;
    }

    if (!isAncestorNodeOf(item, target)) {
      continue;
    }

    for (const [key, value] of Object.entries(item)) {
      if (key === "parent") continue;
      if (isNodeLike(value)) {
        (value as EsTreeNode).parent = item;
        queue.push(value as EsTreeNode);
      } else if (Array.isArray(value)) {
        for (const val of value) {
          if (isNodeLike(val)) {
            (val as EsTreeNode).parent = item;
            queue.push(val as EsTreeNode);
          }
        }
      }
    }
  }

  return null;
};

const joinEnglish = (arr: string[]): string => {
  let result = "";
  for (let i = 0; i < arr.length; i++) {
    result += arr[i];
    if (i === 0 && arr.length === 2) {
      result += " and ";
    } else if (i === arr.length - 2 && arr.length > 2) {
      result += ", and ";
    } else if (i < arr.length - 1) {
      result += ", ";
    }
  }
  return result;
};

const createDepTree = (): DependencyTreeNode => ({
  isUsed: false,
  isSatisfiedRecursively: false,
  isSubtreeUsed: false,
  children: new Map(),
});

const getOrCreateNodeByPath = (rootNode: DependencyTreeNode, path: string): DependencyTreeNode => {
  const keys = path.split(".");
  let current = rootNode;
  for (const key of keys) {
    let child = current.children.get(key);
    if (!child) {
      child = createDepTree();
      current.children.set(key, child);
    }
    current = child;
  }
  return current;
};

const markAllParentsByPath = (
  rootNode: DependencyTreeNode,
  path: string,
  fn: (node: DependencyTreeNode) => void,
): void => {
  const keys = path.split(".");
  let current = rootNode;
  for (const key of keys) {
    const child = current.children.get(key);
    if (!child) return;
    fn(child);
    current = child;
  }
};

const scanTreeRecursively = (
  treeNode: DependencyTreeNode,
  missingPaths: Set<string>,
  satisfyingPaths: Set<string>,
  keyToPath: (key: string) => string,
): void => {
  treeNode.children.forEach((child, key) => {
    const path = keyToPath(key);
    if (child.isSatisfiedRecursively) {
      if (child.isSubtreeUsed) {
        satisfyingPaths.add(path);
      }
      return;
    }
    if (child.isUsed) {
      missingPaths.add(path);
      return;
    }
    scanTreeRecursively(child, missingPaths, satisfyingPaths, (childKey) => `${path}.${childKey}`);
  });
};

const collectRecommendations = ({
  dependencies,
  declaredDependencies,
  stableDependencies,
  externalDependencies,
  isEffect,
}: {
  dependencies: Map<string, Dependency>;
  declaredDependencies: DeclaredDependency[];
  stableDependencies: Set<string>;
  externalDependencies: Set<string>;
  isEffect: boolean;
}): {
  suggestedDependencies: string[];
  unnecessaryDependencies: Set<string>;
  missingDependencies: Set<string>;
  duplicateDependencies: Set<string>;
} => {
  const depTree = createDepTree();

  dependencies.forEach((_dep, key) => {
    const treeNode = getOrCreateNodeByPath(depTree, key);
    treeNode.isUsed = true;
    markAllParentsByPath(depTree, key, (parent) => {
      parent.isSubtreeUsed = true;
    });
  });

  for (const { key } of declaredDependencies) {
    const treeNode = getOrCreateNodeByPath(depTree, key);
    treeNode.isSatisfiedRecursively = true;
  }
  stableDependencies.forEach((key) => {
    const treeNode = getOrCreateNodeByPath(depTree, key);
    treeNode.isSatisfiedRecursively = true;
  });

  const missingDependencies = new Set<string>();
  const satisfyingDependencies = new Set<string>();
  scanTreeRecursively(depTree, missingDependencies, satisfyingDependencies, (key) => key);

  const suggestedDependencies: string[] = [];
  const unnecessaryDependencies = new Set<string>();
  const duplicateDependencies = new Set<string>();

  for (const { key } of declaredDependencies) {
    if (satisfyingDependencies.has(key)) {
      if (!suggestedDependencies.includes(key)) {
        suggestedDependencies.push(key);
      } else {
        duplicateDependencies.add(key);
      }
    } else {
      if (isEffect && !key.endsWith(".current") && !externalDependencies.has(key)) {
        if (!suggestedDependencies.includes(key)) {
          suggestedDependencies.push(key);
        }
      } else {
        unnecessaryDependencies.add(key);
      }
    }
  }

  missingDependencies.forEach((key) => {
    suggestedDependencies.push(key);
  });

  return {
    suggestedDependencies,
    unnecessaryDependencies,
    missingDependencies,
    duplicateDependencies,
  };
};

const _getConstructionExpressionType = (node: EsTreeNode): string | null => {
  const rec = nodeRecord(node);
  const type = nodeType(node);
  switch (type) {
    case "ObjectExpression":
      return "object";
    case "ArrayExpression":
      return "array";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "function";
    case "ClassExpression":
      return "class";
    case "ConditionalExpression":
      if (
        _getConstructionExpressionType(rec.consequent as EsTreeNode) !== null ||
        _getConstructionExpressionType(rec.alternate as EsTreeNode) !== null
      ) {
        return "conditional";
      }
      return null;
    case "LogicalExpression":
      if (
        _getConstructionExpressionType(rec.left as EsTreeNode) !== null ||
        _getConstructionExpressionType(rec.right as EsTreeNode) !== null
      ) {
        return "logical expression";
      }
      return null;
    case "JSXFragment":
      return "JSX fragment";
    case "JSXElement":
      return "JSX element";
    case "AssignmentExpression":
      if (_getConstructionExpressionType(rec.right as EsTreeNode) !== null) {
        return "assignment expression";
      }
      return null;
    case "NewExpression":
      return "object construction";
    case "Literal": {
      const val = rec.value;
      if (val instanceof RegExp) return "regular expression";
      return null;
    }
    case "TSAsExpression":
      return _getConstructionExpressionType(rec.expression as EsTreeNode);
    default: {
      if (type === "TypeCastExpression" || type === "AsExpression") {
        return _getConstructionExpressionType(rec.expression as EsTreeNode);
      }
      return null;
    }
  }
};

const isStableKnownHookValue = (resolved: ScopeVariable): boolean => {
  if (!Array.isArray(resolved.defs)) return false;
  const def = resolved.defs[0];
  if (!def) return false;

  const defNode = def.node;
  const defRec = nodeRecord(defNode);
  if (defNode.type !== "VariableDeclarator") return false;

  let init = defRec.init as EsTreeNode | null;
  if (!init) return false;

  while (init && (nodeType(init) === "TSAsExpression" || nodeType(init) === "AsExpression")) {
    init = nodeRecord(init).expression as EsTreeNode;
  }
  if (!init) return false;

  const declaration = defNode.parent;
  if (declaration && nodeRecord(declaration).kind === "const" && init.type === "Literal") {
    const val = nodeRecord(init).value;
    if (typeof val === "string" || typeof val === "number" || val === null) {
      return true;
    }
  }

  if (init.type !== "CallExpression") return false;

  let callee = nodeRecord(init).callee as EsTreeNode;
  if (
    callee.type === "MemberExpression" &&
    nodeRecord(callee).object &&
    nodeRecord(nodeRecord(callee).object as EsTreeNode).name === "React" &&
    nodeRecord(callee).property &&
    !nodeRecord(callee).computed
  ) {
    callee = nodeRecord(callee).property as EsTreeNode;
  }
  if (callee.type !== "Identifier") return false;

  const id = defRec.id as EsTreeNode;
  const calleeName = nodeRecord(callee).name as string;

  if (calleeName === "useRef" && id.type === "Identifier") {
    return true;
  }
  if (calleeName === "useEffectEvent" && id.type === "Identifier") {
    return true;
  }
  if (calleeName === "useState" || calleeName === "useReducer" || calleeName === "useActionState") {
    const idRec = nodeRecord(id);
    if (
      id.type === "ArrayPattern" &&
      Array.isArray(idRec.elements) &&
      (idRec.elements as EsTreeNode[]).length === 2 &&
      Array.isArray(resolved.identifiers)
    ) {
      const elements = idRec.elements as (EsTreeNode | null)[];
      if (elements[1] === resolved.identifiers[0]) {
        return true;
      }
    }
  }
  if (calleeName === "useTransition") {
    const idRec = nodeRecord(id);
    if (
      id.type === "ArrayPattern" &&
      Array.isArray(idRec.elements) &&
      (idRec.elements as EsTreeNode[]).length === 2 &&
      Array.isArray(resolved.identifiers)
    ) {
      const elements = idRec.elements as (EsTreeNode | null)[];
      if (elements[1] === resolved.identifiers[0]) {
        return true;
      }
    }
  }
  return false;
};

const isFunctionWithoutCapturedValues = (
  resolved: ScopeVariable,
  componentScope: Scope,
  pureScopes: Set<Scope>,
): boolean => {
  if (!Array.isArray(resolved.defs)) return false;
  const def = resolved.defs[0];
  if (!def || !def.node) return false;

  const fnNode = def.node;
  const childScopes = componentScope.childScopes || [];
  let fnScope: Scope | null = null;

  for (const childScope of childScopes) {
    const childScopeBlock = childScope.block;
    if (
      (fnNode.type === "FunctionDeclaration" && childScopeBlock === fnNode) ||
      (fnNode.type === "VariableDeclarator" && childScopeBlock.parent === fnNode)
    ) {
      fnScope = childScope;
      break;
    }
  }
  if (!fnScope) return false;

  for (const ref of fnScope.through) {
    if (!ref.resolved) continue;
    if (pureScopes.has(ref.resolved.scope) && !isStableKnownHookValue(ref.resolved)) {
      return false;
    }
  }
  return true;
};

export const scopeExhaustiveDeps = defineRule<Rule>({
  id: "scope-exhaustive-deps",
  severity: "warn",
  recommendation:
    "React Hook has missing or unnecessary dependencies. Either include them or remove the dependency array. See https://react.dev/learn/removing-effect-dependencies",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!context.sourceCode) return;

      const callRec = nodeRecord(node);
      const callee = callRec.callee as EsTreeNode;
      const callbackIndex = getReactiveHookCallbackIndex(callee);
      if (callbackIndex === -1) return;

      const args = callRec.arguments as EsTreeNode[];
      let callback = args[callbackIndex];
      if (!callback) return;

      const reactiveHook = callee;
      const nodeWithoutNamespace = getNodeWithoutReactNamespace(reactiveHook);
      const reactiveHookName =
        "name" in nodeWithoutNamespace ? (nodeRecord(nodeWithoutNamespace).name as string) : "";

      const maybeNode = args[callbackIndex + 1];
      const declaredDependenciesNode =
        maybeNode &&
        !(maybeNode.type === "Identifier" && nodeRecord(maybeNode).name === "undefined")
          ? maybeNode
          : undefined;

      const isEffect = /Effect($|[^a-z])/g.test(reactiveHookName);

      if (!declaredDependenciesNode && !isEffect) {
        if (reactiveHookName === "useMemo" || reactiveHookName === "useCallback") {
          context.report({
            node: reactiveHook,
            message: `React Hook ${reactiveHookName} does nothing when called with only one argument. Did you forget to pass an array of dependencies?`,
          });
        }
        return;
      }

      while (nodeType(callback) === "TSAsExpression" || nodeType(callback) === "AsExpression") {
        callback = nodeRecord(callback).expression as EsTreeNode;
      }

      if (callback.type !== "FunctionExpression" && callback.type !== "ArrowFunctionExpression") {
        if (callback.type === "Identifier" && !declaredDependenciesNode) {
          return;
        }
        if (callback.type !== "Identifier") {
          context.report({
            node: reactiveHook,
            message: `React Hook ${reactiveHookName} received a function whose dependencies are unknown. Pass an inline function instead.`,
          });
          return;
        }
      }

      if (isEffect && nodeRecord(callback).async) {
        context.report({
          node: callback,
          message:
            `Effect callbacks are synchronous to prevent race conditions. Put the async function inside:\n\n` +
            "useEffect(() => {\n" +
            "  async function fetchData() {\n" +
            "    // You can await here\n" +
            "  }\n" +
            "  fetchData();\n" +
            `}, [someId]);`,
        });
      }

      const scopeManager = context.sourceCode.scopeManager;
      const scope = scopeManager.acquire(callback);
      if (!scope) return;

      const pureScopes = new Set<Scope>();
      let componentScope: Scope | null = null;
      {
        let currentScope = scope.upper;
        while (currentScope) {
          pureScopes.add(currentScope);
          if (
            currentScope.type === "function" ||
            currentScope.type === "hook" ||
            currentScope.type === "component"
          ) {
            break;
          }
          currentScope = currentScope.upper;
        }
        if (!currentScope) return;
        componentScope = currentScope;
      }

      const isInsideEffectCleanup = (reference: ScopeReference): boolean => {
        let curScope: Scope | null = reference.from;
        let isInReturnedFunction = false;
        while (curScope && curScope.block !== callback) {
          if (curScope.type === "function") {
            isInReturnedFunction =
              curScope.block.parent !== null &&
              curScope.block.parent !== undefined &&
              curScope.block.parent.type === "ReturnStatement";
          }
          curScope = curScope.upper;
        }
        return isInReturnedFunction;
      };

      const dependencies = new Map<string, Dependency>();

      const gatherDependenciesRecursively = (currentScope: Scope): void => {
        for (const reference of currentScope.references) {
          if (!reference.resolved) continue;
          if (!pureScopes.has(reference.resolved.scope)) continue;

          const referenceNode = fastFindReferenceWithParent(callback, reference.identifier);
          if (!referenceNode) continue;

          const dependencyNode = getDependency(referenceNode);
          let dependency: string;
          try {
            dependency = analyzePropertyChain(dependencyNode);
          } catch {
            continue;
          }

          if (
            dependencyNode.parent?.type === "TSTypeQuery" ||
            dependencyNode.parent?.type === "TSTypeReference"
          ) {
            continue;
          }

          const def = reference.resolved.defs[0];
          if (!def) continue;
          if (def.node && nodeRecord(def.node).init === node.parent) continue;

          if (!dependencies.has(dependency)) {
            const resolved = reference.resolved;
            const isStable =
              isStableKnownHookValue(resolved) ||
              isFunctionWithoutCapturedValues(resolved, componentScope!, pureScopes);
            dependencies.set(dependency, { isStable, references: [reference] });
          } else {
            dependencies.get(dependency)?.references.push(reference);
          }
        }

        for (const childScope of currentScope.childScopes) {
          gatherDependenciesRecursively(childScope);
        }
      };

      gatherDependenciesRecursively(scope);

      if (isEffect) {
        const currentRefsInCleanup = new Map<
          string,
          { reference: ScopeReference; dependencyNode: EsTreeNode }
        >();

        dependencies.forEach(({ references }, dep) => {
          for (const reference of references) {
            const refNode = fastFindReferenceWithParent(callback, reference.identifier);
            if (!refNode) continue;
            const depNode = getDependency(refNode);
            if (
              depNode.type === "Identifier" &&
              depNode.parent &&
              (nodeType(depNode.parent) === "MemberExpression" ||
                nodeType(depNode.parent) === "OptionalMemberExpression") &&
              !nodeRecord(depNode.parent).computed &&
              (nodeRecord(depNode.parent).property as EsTreeNode)?.type === "Identifier" &&
              nodeRecord(nodeRecord(depNode.parent).property as EsTreeNode).name === "current" &&
              isInsideEffectCleanup(reference)
            ) {
              currentRefsInCleanup.set(dep, { reference, dependencyNode: depNode });
            }
          }
        });

        currentRefsInCleanup.forEach(({ reference, dependencyNode }, dep) => {
          const references = reference.resolved?.references || [];
          let foundCurrentAssignment = false;
          for (const ref of references) {
            const identParent = ref.identifier.parent;
            if (
              identParent &&
              identParent.type === "MemberExpression" &&
              !nodeRecord(identParent).computed &&
              (nodeRecord(identParent).property as EsTreeNode)?.type === "Identifier" &&
              nodeRecord(nodeRecord(identParent).property as EsTreeNode).name === "current" &&
              identParent.parent?.type === "AssignmentExpression" &&
              nodeRecord(identParent.parent).left === identParent
            ) {
              foundCurrentAssignment = true;
              break;
            }
          }
          if (foundCurrentAssignment) return;
          context.report({
            node: dependencyNode,
            message:
              `The ref value '${dep}.current' will likely have changed by the time this effect cleanup function runs. ` +
              `Copy '${dep}.current' to a variable inside the effect, and use that variable in the cleanup function.`,
          });
        });
      }

      const stableDependencies = new Set<string>();
      dependencies.forEach(({ isStable }, key) => {
        if (isStable) stableDependencies.add(key);
      });

      if (!declaredDependenciesNode) {
        if (dependencies.size > 0 && isEffect) {
          const { suggestedDependencies } = collectRecommendations({
            dependencies,
            declaredDependencies: [],
            stableDependencies,
            externalDependencies: new Set(),
            isEffect: true,
          });
          if (suggestedDependencies.length > 0) {
            context.report({
              node: reactiveHook,
              message:
                `React Hook ${reactiveHookName} contains dependencies that could lead to an infinite chain of updates. ` +
                `Pass [${suggestedDependencies.join(", ")}] as a second argument to the ${reactiveHookName} Hook.`,
            });
          }
        }
        return;
      }

      const declaredDependencies: DeclaredDependency[] = [];
      const externalDependencies = new Set<string>();
      const declaredDepsRec = nodeRecord(declaredDependenciesNode);

      if (declaredDependenciesNode.type !== "ArrayExpression") {
        const isTSAsArray =
          declaredDependenciesNode.type === "TSAsExpression" &&
          (declaredDepsRec.expression as EsTreeNode)?.type === "ArrayExpression";

        if (!isTSAsArray) {
          context.report({
            node: declaredDependenciesNode,
            message: `React Hook ${reactiveHookName} was passed a dependency list that is not an array literal. This means we can't statically verify whether you've passed the correct dependencies.`,
          });
          return;
        }
      }

      const arrayExpression =
        declaredDependenciesNode.type === "TSAsExpression"
          ? (declaredDepsRec.expression as EsTreeNode)
          : declaredDependenciesNode;

      const elements = nodeRecord(arrayExpression).elements as (EsTreeNode | null)[];
      if (elements) {
        for (const declaredDependencyNode of elements) {
          if (!declaredDependencyNode) continue;
          if (declaredDependencyNode.type === "SpreadElement") {
            context.report({
              node: declaredDependencyNode,
              message: `React Hook ${reactiveHookName} has a spread element in its dependency array. This means we can't statically verify whether you've passed the correct dependencies.`,
            });
            continue;
          }

          let declaredDependency: string;
          try {
            declaredDependency = analyzePropertyChain(declaredDependencyNode);
          } catch {
            if (declaredDependencyNode.type === "Literal") {
              context.report({
                node: declaredDependencyNode,
                message: `The ${nodeRecord(declaredDependencyNode).raw} literal is not a valid dependency because it never changes. You can safely remove it.`,
              });
            } else {
              context.report({
                node: declaredDependencyNode,
                message: `React Hook ${reactiveHookName} has a complex expression in the dependency array. Extract it to a separate variable so it can be statically checked.`,
              });
            }
            continue;
          }

          declaredDependencies.push({
            key: declaredDependency,
            node: declaredDependencyNode,
          });

          let maybeID: EsTreeNode = declaredDependencyNode;
          let maybeIDType = nodeType(maybeID);
          while (
            maybeIDType === "MemberExpression" ||
            maybeIDType === "OptionalMemberExpression" ||
            maybeIDType === "ChainExpression"
          ) {
            const maybeRec = nodeRecord(maybeID);
            const next = maybeRec.object || maybeRec.expression;
            if (!next || typeof next !== "object" || !("type" in next)) break;
            maybeID = next as unknown as EsTreeNode;
            maybeIDType = nodeType(maybeID);
          }
          const isDeclaredInComponent = !componentScope!.through.some(
            (ref) => ref.identifier === maybeID,
          );
          if (!isDeclaredInComponent) {
            externalDependencies.add(declaredDependency);
          }
        }
      }

      const {
        suggestedDependencies,
        unnecessaryDependencies,
        missingDependencies,
        duplicateDependencies,
      } = collectRecommendations({
        dependencies,
        declaredDependencies,
        stableDependencies,
        externalDependencies,
        isEffect,
      });

      const problemCount =
        duplicateDependencies.size + missingDependencies.size + unnecessaryDependencies.size;

      if (problemCount === 0) return;

      let suggestedDeps = suggestedDependencies;
      if (!isEffect && missingDependencies.size > 0) {
        suggestedDeps = collectRecommendations({
          dependencies,
          declaredDependencies: [],
          stableDependencies,
          externalDependencies,
          isEffect,
        }).suggestedDependencies;
      }

      const areDeclaredDepsAlphabetized = (): boolean => {
        if (declaredDependencies.length === 0) return true;
        const declaredDepKeys = declaredDependencies.map((dep) => dep.key);
        const sortedKeys = declaredDepKeys.slice().sort();
        return declaredDepKeys.join(",") === sortedKeys.join(",");
      };
      if (areDeclaredDepsAlphabetized()) {
        suggestedDeps.sort();
      }

      const getWarningMessage = (
        deps: Set<string>,
        singlePrefix: string,
        label: string,
        fixVerb: string,
      ): string | null => {
        if (deps.size === 0) return null;
        return (
          (deps.size > 1 ? "" : singlePrefix + " ") +
          label +
          " " +
          (deps.size > 1 ? "dependencies" : "dependency") +
          ": " +
          joinEnglish(
            Array.from(deps)
              .sort()
              .map((dep) => `'${dep}'`),
          ) +
          `. Either ${fixVerb} ${deps.size > 1 ? "them" : "it"} or remove the dependency array.`
        );
      };

      const missingMsg = getWarningMessage(missingDependencies, "a", "missing", "include");
      const unnecessaryMsg = getWarningMessage(
        unnecessaryDependencies,
        "an",
        "unnecessary",
        "exclude",
      );
      const duplicateMsg = getWarningMessage(duplicateDependencies, "a", "duplicate", "omit");

      const messages = [missingMsg, unnecessaryMsg, duplicateMsg].filter(Boolean);
      const hookNameText = reactiveHookName;

      context.report({
        node: declaredDependenciesNode,
        message: `React Hook ${hookNameText} has ${messages.join(" ")}`,
      });
    },
  }),
});
