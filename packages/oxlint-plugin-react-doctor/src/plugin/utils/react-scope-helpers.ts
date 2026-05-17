import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import type { ScopeReference } from "./scope-types.js";
import {
  getDownstreamRefs,
  getRef,
  getUpstreamRefs,
  isEventualCallTo,
} from "./scope-traversal.js";

export const isReactFunctionalComponent = (node: EsTreeNode): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  if (node.type === "FunctionDeclaration") {
    const id = nodeRecord.id as EsTreeNode | undefined;
    return Boolean(
      id?.type === "Identifier" &&
      isUppercaseFirst((id as unknown as Record<string, unknown>).name as string),
    );
  }
  if (node.type === "VariableDeclarator") {
    const init = nodeRecord.init as EsTreeNode | undefined;
    if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "CallExpression"))
      return false;
    const id = nodeRecord.id as EsTreeNode | undefined;
    return Boolean(
      id?.type === "Identifier" &&
      isUppercaseFirst((id as unknown as Record<string, unknown>).name as string),
    );
  }
  return false;
};

export const isReactFunctionalHOC = (context: RuleContext, node: EsTreeNode): boolean => {
  const KNOWN_PURE_HOCS = new Set(["memo", "forwardRef"]);
  const nodeRecord = node as unknown as Record<string, unknown>;

  const isWrappedInline = (): boolean => {
    if (node.type !== "VariableDeclarator") return false;
    const init = nodeRecord.init as EsTreeNode | undefined;
    if (!init || init.type !== "CallExpression") return false;
    const initRecord = init as unknown as Record<string, unknown>;
    const callee = initRecord.callee as EsTreeNode | undefined;
    if (!callee || callee.type !== "Identifier") return false;
    const calleeName = (callee as unknown as Record<string, unknown>).name as string;
    if (KNOWN_PURE_HOCS.has(calleeName)) return false;
    const args = initRecord.arguments as EsTreeNode[] | undefined;
    if (!args || args.length === 0) return false;
    return args[0].type === "ArrowFunctionExpression" || args[0].type === "FunctionExpression";
  };

  const isWrappedSeparately = (): boolean => {
    const id = nodeRecord.id as EsTreeNode | undefined;
    if (!id) return false;
    const ref = getRef(context, id);
    if (!ref?.resolved) return false;
    return ref.resolved.references
      .filter((refItem) => {
        const parent = refItem.identifier.parent;
        if (!parent || parent.type !== "CallExpression") return false;
        const parentRecord = parent as unknown as Record<string, unknown>;
        const args = parentRecord.arguments as EsTreeNode[] | undefined;
        return Boolean(args?.includes(refItem.identifier));
      })
      .map((refItem) => refItem.identifier.parent!)
      .some((wrapper) => {
        const wrapperRecord = wrapper as unknown as Record<string, unknown>;
        const callee = wrapperRecord.callee as EsTreeNode | undefined;
        if (!callee || callee.type !== "Identifier") return true;
        const calleeName = (callee as unknown as Record<string, unknown>).name as string;
        return !KNOWN_PURE_HOCS.has(calleeName);
      });
  };

  return isReactFunctionalComponent(node) && (isWrappedInline() || isWrappedSeparately());
};

export const isCustomHook = (node: EsTreeNode): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const id = nodeRecord.id as EsTreeNode | undefined;
  if (!id || id.type !== "Identifier") return false;
  const name = (id as unknown as Record<string, unknown>).name as string;
  if (!name.startsWith("use") || name.length < 4) return false;
  if (name[3] !== name[3].toUpperCase()) return false;

  if (node.type === "FunctionDeclaration") return true;
  if (node.type === "VariableDeclarator") {
    const init = nodeRecord.init as EsTreeNode | undefined;
    return Boolean(
      init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression"),
    );
  }
  return false;
};

export const isUseState = (node: EsTreeNode): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  if (node.type === "Identifier" && nodeRecord.name === "useState") return true;
  if (node.type === "MemberExpression") {
    const obj = nodeRecord.object as EsTreeNode | undefined;
    const prop = nodeRecord.property as EsTreeNode | undefined;
    return Boolean(
      obj?.type === "Identifier" &&
      (obj as unknown as Record<string, unknown>).name === "React" &&
      prop?.type === "Identifier" &&
      (prop as unknown as Record<string, unknown>).name === "useState",
    );
  }
  if (node.parent?.type === "MemberExpression") {
    const parentRecord = node.parent as unknown as Record<string, unknown>;
    const obj = parentRecord.object as EsTreeNode | undefined;
    const prop = parentRecord.property as EsTreeNode | undefined;
    return Boolean(
      obj?.type === "Identifier" &&
      (obj as unknown as Record<string, unknown>).name === "React" &&
      prop?.type === "Identifier" &&
      (prop as unknown as Record<string, unknown>).name === "useState",
    );
  }
  return false;
};

export const isUseRef = (node: EsTreeNode): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  if (node.type === "Identifier" && nodeRecord.name === "useRef") return true;
  if (node.parent?.type === "MemberExpression") {
    const parentRecord = node.parent as unknown as Record<string, unknown>;
    const obj = parentRecord.object as EsTreeNode | undefined;
    const prop = parentRecord.property as EsTreeNode | undefined;
    return Boolean(
      obj?.type === "Identifier" &&
      (obj as unknown as Record<string, unknown>).name === "React" &&
      prop?.type === "Identifier" &&
      (prop as unknown as Record<string, unknown>).name === "useRef",
    );
  }
  return false;
};

export const isUseEffect = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  const nodeRecord = node as unknown as Record<string, unknown>;
  const callee = nodeRecord.callee as EsTreeNode | undefined;
  if (!callee) return false;
  if (callee.type === "Identifier") {
    return (callee as unknown as Record<string, unknown>).name === "useEffect";
  }
  if (callee.type === "MemberExpression") {
    const calleeRecord = callee as unknown as Record<string, unknown>;
    const obj = calleeRecord.object as EsTreeNode | undefined;
    const prop = calleeRecord.property as EsTreeNode | undefined;
    return Boolean(
      obj?.type === "Identifier" &&
      (obj as unknown as Record<string, unknown>).name === "React" &&
      prop?.type === "Identifier" &&
      (prop as unknown as Record<string, unknown>).name === "useEffect",
    );
  }
  return false;
};

export const getEffectFn = (node: EsTreeNode): EsTreeNode | undefined => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const args = nodeRecord.arguments as EsTreeNode[] | undefined;
  const effectFn = args?.[0];
  if (!effectFn) return undefined;
  if (effectFn.type !== "ArrowFunctionExpression" && effectFn.type !== "FunctionExpression")
    return undefined;
  return effectFn;
};

export const getEffectFnRefs = (
  context: RuleContext,
  node: EsTreeNode,
): ScopeReference[] | undefined => {
  const effectFn = getEffectFn(node);
  return effectFn ? getDownstreamRefs(context, effectFn) : undefined;
};

export const getEffectDepsRefs = (
  context: RuleContext,
  node: EsTreeNode,
): ScopeReference[] | undefined => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const args = nodeRecord.arguments as EsTreeNode[] | undefined;
  const depsArr = args?.[1];
  if (!depsArr || depsArr.type !== "ArrayExpression") return undefined;
  return getDownstreamRefs(context, depsArr);
};

export const isState = (ref: ScopeReference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const defNodeRecord = def.node as unknown as Record<string, unknown>;
      if (def.node.type !== "VariableDeclarator") return false;
      const init = defNodeRecord.init as EsTreeNode | undefined;
      if (!init || init.type !== "CallExpression") return false;
      const initRecord = init as unknown as Record<string, unknown>;
      const callee = initRecord.callee as EsTreeNode | undefined;
      if (!callee || !isUseState(callee)) return false;
      const id = defNodeRecord.id as EsTreeNode | undefined;
      if (!id || id.type !== "ArrayPattern") return false;
      const idRecord = id as unknown as Record<string, unknown>;
      const elements = idRecord.elements as (EsTreeNode | null)[] | undefined;
      if (!elements || (elements.length !== 1 && elements.length !== 2)) return false;
      const refName = (ref.identifier as unknown as Record<string, unknown>).name as string;
      return Boolean(
        elements[0]?.type === "Identifier" &&
        (elements[0] as unknown as Record<string, unknown>).name === refName,
      );
    }),
  );

export const isStateSetter = (ref: ScopeReference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const defNodeRecord = def.node as unknown as Record<string, unknown>;
      if (def.node.type !== "VariableDeclarator") return false;
      const init = defNodeRecord.init as EsTreeNode | undefined;
      if (!init || init.type !== "CallExpression") return false;
      const initRecord = init as unknown as Record<string, unknown>;
      const callee = initRecord.callee as EsTreeNode | undefined;
      if (!callee || !isUseState(callee)) return false;
      const id = defNodeRecord.id as EsTreeNode | undefined;
      if (!id || id.type !== "ArrayPattern") return false;
      const idRecord = id as unknown as Record<string, unknown>;
      const elements = idRecord.elements as (EsTreeNode | null)[] | undefined;
      if (!elements || elements.length !== 2) return false;
      const refName = (ref.identifier as unknown as Record<string, unknown>).name as string;
      return Boolean(
        elements[1]?.type === "Identifier" &&
        (elements[1] as unknown as Record<string, unknown>).name === refName,
      );
    }),
  );

export const isProp = (context: RuleContext, ref: ScopeReference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      if (def.type !== "Parameter") return false;
      const defNode = def.node;
      let declaringNode: EsTreeNode;
      if (defNode.type === "ArrowFunctionExpression") {
        const parent = defNode.parent;
        declaringNode =
          parent?.type === "CallExpression"
            ? (parent.parent ?? defNode.parent ?? defNode)
            : (defNode.parent ?? defNode);
      } else {
        declaringNode = defNode;
      }
      return (
        (isReactFunctionalComponent(declaringNode) &&
          !isReactFunctionalHOC(context, declaringNode)) ||
        isCustomHook(declaringNode)
      );
    }),
  );

export const isConstant = (ref: ScopeReference): boolean =>
  Boolean(
    (ref.resolved?.defs ?? []).some((def) => {
      const defNodeRecord = def.node as unknown as Record<string, unknown>;
      const init = defNodeRecord.init as EsTreeNode | undefined;
      if (!init) return false;
      return (
        init.type === "Literal" ||
        init.type === "TemplateLiteral" ||
        init.type === "ArrayExpression" ||
        init.type === "ObjectExpression"
      );
    }),
  );

export const isRef = (ref: ScopeReference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const defNodeRecord = def.node as unknown as Record<string, unknown>;
      if (def.node.type !== "VariableDeclarator") return false;
      const init = defNodeRecord.init as EsTreeNode | undefined;
      if (!init || init.type !== "CallExpression") return false;
      const initRecord = init as unknown as Record<string, unknown>;
      const callee = initRecord.callee as EsTreeNode | undefined;
      if (!callee) return false;
      if (callee.type === "Identifier") {
        return (callee as unknown as Record<string, unknown>).name === "useRef";
      }
      if (callee.type === "MemberExpression") {
        const calleeRecord = callee as unknown as Record<string, unknown>;
        const obj = calleeRecord.object as EsTreeNode | undefined;
        const prop = calleeRecord.property as EsTreeNode | undefined;
        return Boolean(
          obj?.type === "Identifier" &&
          (obj as unknown as Record<string, unknown>).name === "React" &&
          prop?.type === "Identifier" &&
          (prop as unknown as Record<string, unknown>).name === "useRef",
        );
      }
      return false;
    }),
  );

export const isRefCurrent = (ref: ScopeReference): boolean => {
  const parent = ref.identifier.parent;
  if (!parent || parent.type !== "MemberExpression") return false;
  const parentRecord = parent as unknown as Record<string, unknown>;
  const prop = parentRecord.property as EsTreeNode | undefined;
  return Boolean(
    prop?.type === "Identifier" && (prop as unknown as Record<string, unknown>).name === "current",
  );
};

export const isStateSetterCall = (context: RuleContext, ref: ScopeReference): boolean =>
  isEventualCallTo(context, ref, isStateSetter);

export const isPropCall = (context: RuleContext, ref: ScopeReference): boolean =>
  isEventualCallTo(context, ref, (innerRef) => isProp(context, innerRef));

export const isRefCall = (context: RuleContext, ref: ScopeReference): boolean =>
  isEventualCallTo(context, ref, (innerRef) => isRefCurrent(innerRef) || isRef(innerRef));

export const getUseStateDecl = (
  context: RuleContext,
  ref: ScopeReference,
): EsTreeNode | undefined => {
  let node: EsTreeNode | undefined = getUpstreamRefs(context, ref).find((innerRef) =>
    isUseState(innerRef.identifier),
  )?.identifier;
  while (node && node.type !== "VariableDeclarator") {
    node = node.parent ?? undefined;
  }
  return node;
};

export const hasCleanup = (node: EsTreeNode): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const args = nodeRecord.arguments as EsTreeNode[] | undefined;
  const effectFn = args?.[0];
  if (!effectFn) return false;
  if (effectFn.type !== "ArrowFunctionExpression" && effectFn.type !== "FunctionExpression")
    return false;
  const effectFnRecord = effectFn as unknown as Record<string, unknown>;
  const body = effectFnRecord.body as EsTreeNode | undefined;
  if (!body || body.type !== "BlockStatement") return false;
  const bodyRecord = body as unknown as Record<string, unknown>;
  const statements = bodyRecord.body as EsTreeNode[] | undefined;
  if (!statements) return false;
  return statements.some(
    (stmt) =>
      stmt.type === "ReturnStatement" &&
      Boolean((stmt as unknown as Record<string, unknown>).argument),
  );
};

export const findContainingNode = (
  context: RuleContext,
  node: EsTreeNode | undefined | null,
): EsTreeNode | undefined => {
  if (!node) return undefined;
  if (isReactFunctionalComponent(node) || isReactFunctionalHOC(context, node) || isCustomHook(node))
    return node;
  return findContainingNode(context, node.parent);
};

const isUppercaseFirst = (name: string): boolean =>
  name.length > 0 && name[0] === name[0].toUpperCase();
