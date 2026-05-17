import { closureCaptures } from "../../semantic/closure-captures.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Port of `oxc_linter::rules::react::exhaustive_deps`. Diffs the
// closure-captured set of an effect / memo callback against its
// declared dependency array. Built on top of Phase A's scope analyzer
// and Phase C's closure-capture helper.

const buildMissingDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` is missing dependency \`${depName}\` — list it in the dependency array, or call the hook unconditionally.`;
const buildUnnecessaryDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has an unnecessary dependency \`${depName}\` — it isn't referenced inside the callback.`;
const buildDuplicateDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` has duplicate dependency \`${depName}\`.`;
const buildLiteralDepMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` was passed a literal as a dependency. Literals never change so they cannot trigger an update — remove them from the dependency array.`;
const buildRefCurrentDepMessage = (hookName: string, depName: string): string =>
  `React Hook \`${hookName}\` shouldn't include \`${depName}\` in the dependency array — mutable values like \`.current\` aren't valid deps; depend on \`${depName.replace(/\.current$/, "")}\` itself instead.`;
const buildNonArrayDepsMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` has a second argument which is not an array literal. This means oxlint cannot statically verify whether the dependencies are exhaustive — replace the variable with an inline array.`;
const buildMissingDepArrayMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` does nothing when called with only one argument — pass a dependency array as the second argument.`;
const buildMissingCallbackMessage = (hookName: string): string =>
  `React Hook \`${hookName}\` requires an effect callback — pass a function as the first argument.`;

interface ExhaustiveDepsSettings {
  additionalHooks?: string;
  enableDangerousAutofixThisMayCauseInfiniteLoops?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<ExhaustiveDepsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { exhaustiveDeps?: ExhaustiveDepsSettings }).exhaustiveDeps ?? {})
      : {};
  return {
    additionalHooks: ruleSettings.additionalHooks ?? "",
    enableDangerousAutofixThisMayCauseInfiniteLoops:
      ruleSettings.enableDangerousAutofixThisMayCauseInfiniteLoops ?? false,
  };
};

// Hooks whose callback captures must match a deps array.
const HOOKS_REQUIRING_DEPS_MATCH: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
  "useInsertionEffect",
]);

// Hooks where the deps array is REQUIRED (silently doing nothing
// without one is a common bug). useEffect / useLayoutEffect /
// useInsertionEffect tolerate omitting deps (intentional
// run-on-every-render); useMemo / useCallback / useImperativeHandle
// do not.
const HOOKS_REQUIRING_DEPS_ARRAY: ReadonlySet<string> = new Set([
  "useMemo",
  "useCallback",
  "useImperativeHandle",
]);

const buildAdditionalHooksRegex = (additional: string): RegExp | null => {
  if (!additional) return null;
  try {
    return new RegExp(additional);
  } catch {
    return null;
  }
};

const getHookName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};

// True for symbols whose returned value (or destructured pieces) are
// stable across re-renders and don't need to live in deps arrays:
//   useState's setter (`setX`)
//   useReducer's dispatch
//   useRef's ref object
//   useEffectEvent's return value
//   primitive-literal local consts (the value never changes between
//     renders unless the literal does)
const symbolHasStableHookOrigin = (symbol: SymbolDescriptor): boolean => {
  // We need the binding's parent context. The symbol's
  // declarationNode is the VariableDeclarator (when destructured) or
  // the binding identifier itself.
  let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarator && declarator.type !== "VariableDeclarator") {
    declarator = declarator.parent ?? null;
  }
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const initializer = declarator.init;
  if (!initializer) return false;

  // Primitive literal initializer of a `const` binding — the value
  // cannot change between renders, so the captured reference is
  // structurally stable for dep-array purposes. `let` / `var` could
  // be reassigned and don't qualify.
  if (symbol.kind === "const") {
    if (
      isNodeOfType(initializer, "Literal") &&
      (initializer.value === null ||
        typeof initializer.value === "number" ||
        typeof initializer.value === "string" ||
        typeof initializer.value === "boolean")
    ) {
      return true;
    }
    if (isNodeOfType(initializer, "TemplateLiteral") && initializer.expressions.length === 0) {
      return true;
    }
  }

  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const initializerHookName = getHookName(initializer.callee);
  if (!initializerHookName) return false;
  // useRef returns a stable ref; the binding itself is the ref.
  if (initializerHookName === "useRef") return true;
  // useEffectEvent returns a stable callback (React's RFC).
  if (initializerHookName === "useEffectEvent") return true;
  // useState / useReducer: the SECOND destructure element (setter /
  // dispatch) is stable; the first is mutable.
  if (initializerHookName === "useState" || initializerHookName === "useReducer") {
    if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
    const STABLE_RETURN_INDEX = 1;
    const elements = declarator.id.elements;
    const stableElement = elements[STABLE_RETURN_INDEX];
    if (!stableElement) return false;
    const innerBinding = isNodeOfType(stableElement as EsTreeNode, "AssignmentPattern")
      ? (stableElement as EsTreeNodeOfType<"AssignmentPattern">).left
      : (stableElement as EsTreeNode);
    return isNodeOfType(innerBinding, "Identifier") && symbol.bindingIdentifier === innerBinding;
  }
  return false;
};

// Returns the bare identifier name of a captured reference, regardless
// of whether the reference came in via a JS `Identifier` or a
// `JSXIdentifier` (e.g. `<Component />`'s tag, which captures the
// component binding the same way `Component()` would).
const flattenReferenceRootName = (reference: ReferenceDescriptor): string => {
  const referencedIdentifier = reference.identifier;
  if (isNodeOfType(referencedIdentifier, "Identifier")) return referencedIdentifier.name;
  if (isNodeOfType(referencedIdentifier, "JSXIdentifier")) return referencedIdentifier.name;
  return "";
};

// Computes the dep "key" (root identifier name OR the full member-path)
// for a captured reference. e.g.:
//   reference points to `count`            → "count"
//   reference is `props` in `props.foo`    → "props.foo"
//   reference is `ref` in `ref.current`    → "ref" (`.current` access
//                                             doesn't add a dep)
const computeDepKey = (reference: ReferenceDescriptor): string => {
  const referencedIdentifier = reference.identifier;
  let parent = referencedIdentifier.parent ?? null;
  // Strip ChainExpression wrappers (a?.b parses to `ChainExpression {
  // expression: MemberExpression }`).
  if (parent && parent.type === "ChainExpression") {
    parent = parent.parent ?? null;
  }
  if (
    !parent ||
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== referencedIdentifier
  ) {
    return flattenReferenceRootName(reference);
  }
  // Walk up to the outermost MemberExpression (through any
  // ChainExpression wrappers in between).
  let outermost: EsTreeNode = parent;
  while (true) {
    const grandparent: EsTreeNode | null | undefined = outermost.parent;
    if (!grandparent) break;
    const candidate: EsTreeNode | null | undefined =
      grandparent.type === "ChainExpression"
        ? (grandparent as { parent?: EsTreeNode | null }).parent
        : grandparent;
    const expectedObject: EsTreeNode =
      grandparent.type === "ChainExpression" ? grandparent : outermost;
    if (
      candidate &&
      isNodeOfType(candidate, "MemberExpression") &&
      candidate.object === expectedObject
    ) {
      outermost = candidate;
      continue;
    }
    break;
  }
  const fullName = stringifyMemberChain(outermost);
  if (fullName === null) return flattenReferenceRootName(reference);
  // Strip `.current` suffix for ref-like values; that property is
  // mutable but the ref itself is stable.
  const REF_CURRENT_SUFFIX = ".current";
  if (fullName.endsWith(REF_CURRENT_SUFFIX)) {
    return fullName.slice(0, -REF_CURRENT_SUFFIX.length);
  }
  return fullName;
};

// Strip TypeScript expression wrappers transparently — `(x as T)`,
// `x satisfies T`, `x!`, `(x)` — so they don't change the dep key.
const TRANSPARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
  "ChainExpression",
]);

const unwrapExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    const inner = (current as { expression?: EsTreeNode | null }).expression;
    if (!inner) return current;
    current = inner;
  }
  return current;
};

const computeDeclaredDepKey = (entry: EsTreeNode): string | null => {
  const stripped = unwrapExpression(entry);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "MemberExpression")) {
    return stringifyMemberChain(stripped);
  }
  return null;
};

const stringifyMemberChain = (node: EsTreeNode): string | null => {
  const stripped = unwrapExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name;
  if (isNodeOfType(stripped, "ThisExpression")) return "this";
  if (isNodeOfType(stripped, "MemberExpression")) {
    const objectName = stringifyMemberChain(stripped.object);
    if (objectName && !stripped.computed && isNodeOfType(stripped.property, "Identifier")) {
      return `${objectName}.${stripped.property.name}`;
    }
  }
  return null;
};

interface CaptureCollection {
  keys: Set<string>;
  // Names of bindings that the callback captured but that we filtered
  // out of `keys` because their value is structurally stable (literal
  // const, useState setter, useRef, useEffectEvent, module-scope).
  // These are valid-but-redundant deps — flagging them as unnecessary
  // would diverge from upstream's policy.
  stableCapturedNames: Set<string>;
}

// Walks captures grouping by "dep key" (the canonical name of the
// outermost member-expression chain).
const collectCaptureDepKeys = (callback: EsTreeNode, scopes: ScopeAnalysis): CaptureCollection => {
  const keys = new Set<string>();
  const stableCapturedNames = new Set<string>();
  for (const reference of closureCaptures(callback, scopes)) {
    const symbol = reference.resolvedSymbol;
    if (!symbol) continue;
    if (symbolHasStableHookOrigin(symbol)) {
      stableCapturedNames.add(symbol.name);
      continue;
    }
    // Skip bindings declared outside any function — they don't change
    // between renders, so React doesn't need them in deps. We do NOT
    // mark these as `stableCapturedNames` because module-scope values
    // (especially imports) can technically be mutated externally —
    // upstream still flags them as unnecessary if the user lists them
    // in deps.
    if (isOutsideAllFunctions(symbol)) continue;
    const depKey = computeDepKey(reference);
    if (!depKey) continue;
    keys.add(depKey);
  }
  return { keys, stableCapturedNames };
};

const FUNCTION_SCOPE_KINDS: ReadonlySet<string> = new Set(["function", "arrow-function", "method"]);

const isOutsideAllFunctions = (symbol: SymbolDescriptor): boolean => {
  let scope: SymbolDescriptor["scope"] | null = symbol.scope;
  while (scope) {
    if (FUNCTION_SCOPE_KINDS.has(scope.kind)) return false;
    if (scope.kind === "module") return true;
    scope = scope.parent ?? null;
  }
  return true;
};

const isLiteralOrEmptyTemplate = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") ||
  (isNodeOfType(node, "TemplateLiteral") && node.expressions.length === 0);

const isNonStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value !== "string";

const isMatchingDepOrPrefix = (declaredKey: string, captureKey: string): boolean =>
  captureKey === declaredKey || captureKey.startsWith(`${declaredKey}.`);

export const exhaustiveDeps = defineRule<Rule>({
  id: "exhaustive-deps",
  severity: "warn",
  recommendation: "List every value the hook callback captures in its dependency array.",
  category: "Correctness",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const additionalHooksRegex = buildAdditionalHooksRegex(settings.additionalHooks);
    const isHookOfInterest = (hookName: string): boolean => {
      if (HOOKS_REQUIRING_DEPS_MATCH.has(hookName)) return true;
      if (additionalHooksRegex && additionalHooksRegex.test(hookName)) return true;
      return false;
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const hookName = getHookName(node.callee);
        if (!hookName || !isHookOfInterest(hookName)) return;

        const callbackArgument = node.arguments[0];
        if (!callbackArgument) {
          context.report({ node, message: buildMissingCallbackMessage(hookName) });
          return;
        }
        if (
          !isNodeOfType(callbackArgument, "ArrowFunctionExpression") &&
          !isNodeOfType(callbackArgument, "FunctionExpression")
        ) {
          // Callback that isn't a function literal (e.g. a passed
          // variable) — can't statically analyze its closure. We
          // still flag missing deps for hooks that require them.
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName) && !node.arguments[1]) {
            context.report({ node, message: buildMissingDepArrayMessage(hookName) });
          }
          return;
        }

        const depsArgumentRaw = node.arguments[1];
        if (!depsArgumentRaw) {
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName)) {
            context.report({ node, message: buildMissingDepArrayMessage(hookName) });
          }
          return;
        }

        // null / undefined deps argument → treat as "no deps". Upstream
        // tolerates these as "intentional no-deps" for useEffect-style
        // hooks but flags them for hooks that require deps.
        const depsArgument = unwrapExpression(depsArgumentRaw as EsTreeNode);
        if (
          (isNodeOfType(depsArgument, "Literal") && depsArgument.value === null) ||
          (isNodeOfType(depsArgument, "Identifier") && depsArgument.name === "undefined")
        ) {
          if (HOOKS_REQUIRING_DEPS_ARRAY.has(hookName)) {
            context.report({
              node: depsArgument,
              message: buildMissingDepArrayMessage(hookName),
            });
          }
          return;
        }

        if (!isNodeOfType(depsArgument, "ArrayExpression")) {
          context.report({ node: depsArgument, message: buildNonArrayDepsMessage(hookName) });
          return;
        }

        const { keys: captureKeys, stableCapturedNames } = collectCaptureDepKeys(
          callbackArgument,
          context.scopes,
        );

        // Pre-scan: emit a single "literal deps" warning when the
        // deps array contains a non-string-literal value (numeric /
        // boolean / null / bigint). String-literal deps are usually
        // typos of an identifier ("foo" → foo) and upstream emits
        // those via the missing-dep message's hint instead of an
        // extra summary warning, so we suppress this summary when
        // every literal in the array is a string.
        const hasNonStringLiteralDep = depsArgument.elements.some((element) => {
          if (!element) return false;
          return isNonStringLiteral(unwrapExpression(element as EsTreeNode));
        });
        if (hasNonStringLiteralDep) {
          context.report({ node: depsArgument, message: buildLiteralDepMessage(hookName) });
        }

        const declaredKeys = new Set<string>();
        const declaredKeyToReportNode = new Map<string, EsTreeNode>();
        const seenDeclaredKeys = new Set<string>();
        for (const element of depsArgument.elements) {
          if (!element) continue;
          const elementNode = element as EsTreeNode;
          const stripped = unwrapExpression(elementNode);

          if (isLiteralOrEmptyTemplate(stripped)) continue;

          // Detect `<ref>.current` in deps where `<ref>` is a useRef
          // binding — upstream's "depend on the ref itself, not its
          // mutable .current" warning.
          const fullChain = stringifyMemberChain(stripped);
          if (
            fullChain &&
            fullChain.endsWith(".current") &&
            isNodeOfType(stripped, "MemberExpression") &&
            isNodeOfType(stripped.object, "Identifier")
          ) {
            const refSymbol = context.scopes.symbolFor(stripped.object);
            if (refSymbol && symbolHasStableHookOrigin(refSymbol)) {
              context.report({
                node: elementNode,
                message: buildRefCurrentDepMessage(hookName, fullChain),
              });
              continue;
            }
          }

          const key = computeDeclaredDepKey(elementNode);
          if (key === null) continue;
          if (seenDeclaredKeys.has(key)) {
            context.report({
              node: elementNode,
              message: buildDuplicateDepMessage(hookName, key),
            });
            continue;
          }
          seenDeclaredKeys.add(key);
          declaredKeys.add(key);
          declaredKeyToReportNode.set(key, elementNode);
        }

        for (const captureKey of captureKeys) {
          let isCoveredByDeclared = false;
          for (const declaredKey of declaredKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isCoveredByDeclared = true;
              break;
            }
          }
          if (isCoveredByDeclared) continue;
          context.report({
            node: depsArgument,
            message: buildMissingDepMessage(hookName, captureKey),
          });
        }

        // Unnecessary: declared but not captured. We suppress the
        // report ONLY when the binding was filtered out of captureKeys
        // for being structurally stable (literal-typed local const,
        // useState setter, useRef, useEffectEvent). Other "captured by
        // name but at a different chain depth" mismatches (e.g. declared
        // `local.id` while the callback captures `local`) are real
        // redundancies and we flag them.
        for (const declaredKey of declaredKeys) {
          let isUsed = false;
          for (const captureKey of captureKeys) {
            if (isMatchingDepOrPrefix(declaredKey, captureKey)) {
              isUsed = true;
              break;
            }
          }
          if (isUsed) continue;
          const rootName = declaredKey.split(".")[0]!;
          if (stableCapturedNames.has(rootName)) continue;
          const reportNode = declaredKeyToReportNode.get(declaredKey) ?? depsArgument;
          context.report({
            node: reportNode,
            message: buildUnnecessaryDepMessage(hookName, declaredKey),
          });
        }
      },
    };
  },
});
