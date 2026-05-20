import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Array index in `key` doesn't uniquely identify the element — re-renders may use stale state.";

const SECOND_INDEX_METHODS: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);

const THIRD_INDEX_METHODS: ReadonlySet<string> = new Set(["reduce", "reduceRight"]);

// Returns true when the receiver of the iteration call is provably
// "positional and stable" — its element order is determined by the
// iteration index itself, so an `index`-based key is correct by
// construction. Catches:
//   `Array.from({ length: N }).map((_, i) => ...)`
//   `Array(N).fill(...).map((_, i) => ...)`
//   `str.split(sep).map((_, i) => ...)`  (text-position iteration)
// In each of these the array's identity-vs-position is fixed by the
// source string/length — reordering can't happen, so using the index
// as the key is semantically right.
const isAllLiteralArrayExpression = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ArrayExpression")) return false;
  const elements = node.elements ?? [];
  if (elements.length < 1) return false;
  for (const element of elements) {
    if (!element) return false;
    if (!isNodeOfType(element, "Literal")) return false;
    const value = (element as { value: unknown }).value;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      return false;
  }
  return true;
};

const isPositionallyStableIterationReceiver = (receiver: EsTreeNode): boolean => {
  // `[lit, lit, lit].map(...)` — fixed-shape literal array, order is stable.
  if (isAllLiteralArrayExpression(receiver)) return true;
  // `[...Array(N)].map(...)` or `[...Array.from(...)].map(...)` — spread
  // of an array constructor; the result has a fixed positional shape.
  if (
    isNodeOfType(receiver, "ArrayExpression") &&
    receiver.elements?.length === 1
  ) {
    const only = receiver.elements[0];
    if (only && isNodeOfType(only, "SpreadElement")) {
      const arg = only.argument as EsTreeNode | null;
      if (arg && isPositionallyStableIterationReceiver(arg)) return true;
    }
  }
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  const callee = receiver.callee;
  // Array.from({ length: N })  /  Array.from({ length: N }, ...)
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from" &&
    receiver.arguments.length >= 1 &&
    isNodeOfType(receiver.arguments[0] as EsTreeNode, "ObjectExpression")
  ) {
    return true;
  }
  // Array(N) / new Array(N) — the result has a fixed length, can't reorder.
  if (isNodeOfType(callee, "Identifier") && callee.name === "Array") return true;
  // <expr>.split(...) — text-position iteration. Skip even if chained
  // (e.g. `text.split('\n')`).
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "split"
  ) {
    return true;
  }
  // Chained: `<expr>.fill(...).map(...)` — strip `.fill(...)` and
  // check the receiver. Pattern: `Array(N).fill(0)`.
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    (callee.property.name === "fill" || callee.property.name === "flat")
  ) {
    return isPositionallyStableIterationReceiver(callee.object as EsTreeNode);
  }
  return false;
};

// True when a key template literal mixes the index with a member of the
// iteration variable (`${item.id}-${index}`). The user is defensively
// composing identity + index — the composite key IS stable for that
// iteration, even though it mentions the index.
const templateHasIteratorMember = (
  templateLiteral: EsTreeNodeOfType<"TemplateLiteral">,
  iteratorName: string,
): boolean => {
  for (const expression of templateLiteral.expressions ?? []) {
    if (isNodeOfType(expression, "Identifier") && expression.name === iteratorName)
      return true;
    if (
      isNodeOfType(expression, "MemberExpression") &&
      isNodeOfType(expression.object, "Identifier") &&
      expression.object.name === iteratorName
    )
      return true;
  }
  return false;
};

// Walk up from the JSX opening element to find the iteration callback's
// FIRST parameter (the per-item value, e.g. `item` in `arr.map((item, i) => …)`).
// Returns null if not inside a known iterator callback.
const findIteratorItemName = (node: EsTreeNode): string | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression")
    ) {
      const parent = current.parent;
      if (parent && isNodeOfType(parent, "CallExpression")) {
        const callee = parent.callee;
        const isFirstArg = parent.arguments[0] === current;
        if (
          isFirstArg &&
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.property, "Identifier") &&
          SECOND_INDEX_METHODS.has(callee.property.name)
        ) {
          const first = current.params[0];
          if (first && isNodeOfType(first, "Identifier")) return first.name;
          return null;
        }
      }
      return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

// Find the iteration callback's index parameter binding (Identifier
// node) by walking up from a JSXOpeningElement / CallExpression until
// we find an enclosing array-iteration call.
//
// Returns null if the iteration source is positionally stable (see
// `isPositionallyStableIterationReceiver` above) — `index` keys ARE
// correct in those cases.
const findIndexParameterBinding = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let walker: EsTreeNode | null | undefined = node.parent;
  while (walker) {
    if (
      isNodeOfType(walker, "ArrowFunctionExpression") ||
      isNodeOfType(walker, "FunctionExpression")
    ) {
      const callbackParent = walker.parent;
      if (callbackParent && isNodeOfType(callbackParent, "CallExpression")) {
        const callee = callbackParent.callee;
        const isFirstArg = callbackParent.arguments[0] === walker;
        if (
          isFirstArg &&
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.property, "Identifier")
        ) {
          const methodName = callee.property.name;
          let position: number | null = null;
          if (SECOND_INDEX_METHODS.has(methodName)) position = 1;
          else if (THIRD_INDEX_METHODS.has(methodName)) position = 2;
          if (position !== null) {
            // Iteration source — `<receiver>.map((_, i) => ...)`.
            // Skip the entire rule if the receiver is positionally
            // stable.
            const receiver = callee.object as EsTreeNode;
            if (isPositionallyStableIterationReceiver(receiver)) return null;
            const params = walker.params;
            const param = params[position] as EsTreeNode | undefined;
            if (param && isNodeOfType(param, "Identifier")) {
              return param;
            }
          }
        }
      }
      // Don't cross a function boundary.
      return null;
    }
    walker = walker.parent ?? null;
  }
  return null;
};

const isIndexReference = (expression: EsTreeNode, paramName: string): boolean =>
  isNodeOfType(expression, "Identifier") && expression.name === paramName;

const expressionUsesIndex = (expression: EsTreeNode, paramName: string): boolean => {
  if (isIndexReference(expression, paramName)) return true;
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.expressions.some((innerExpression) =>
      isIndexReference(innerExpression as EsTreeNode, paramName),
    );
  }
  if (isNodeOfType(expression, "BinaryExpression")) {
    const usesInLeft = isIndexReference(expression.left as EsTreeNode, paramName);
    const usesInRight = isIndexReference(expression.right as EsTreeNode, paramName);
    if (usesInLeft || usesInRight) return true;
    if (
      isNodeOfType(expression.left as EsTreeNode, "BinaryExpression") &&
      expressionUsesIndex(expression.left as EsTreeNode, paramName)
    )
      return true;
    if (
      isNodeOfType(expression.right as EsTreeNode, "BinaryExpression") &&
      expressionUsesIndex(expression.right as EsTreeNode, paramName)
    )
      return true;
    return false;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    // index.toString()
    if (
      isNodeOfType(expression.callee, "MemberExpression") &&
      isNodeOfType(expression.callee.property, "Identifier") &&
      expression.callee.property.name === "toString" &&
      isIndexReference(expression.callee.object as EsTreeNode, paramName)
    ) {
      return true;
    }
    // String(index)
    if (
      isNodeOfType(expression.callee, "Identifier") &&
      expression.callee.name === "String" &&
      expression.arguments.length > 0 &&
      isIndexReference(expression.arguments[0] as EsTreeNode, paramName)
    ) {
      return true;
    }
  }
  return false;
};

const isReactCloneElement = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "cloneElement") return false;
  return isNodeOfType(callee.object, "Identifier") && callee.object.name === "React";
};

// Pure-presentational SVG primitives — no DOM state, no event-bound
// identity to corrupt on reorder. `<g>`, `<path>`, `<line>`, etc.
// just draw pixels; React will diff the new attributes regardless of
// reconciliation order, and there's nothing to "lose" if React maps
// the wrong index to the wrong element. Real-world icon / chart code
// uses index keys here as the natural choice.
const PURE_SVG_PRIMITIVE_TAGS: ReadonlySet<string> = new Set([
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "stop",
  "text",
  "tspan",
  "defs",
  "use",
  "mask",
  "marker",
  "linearGradient",
  "radialGradient",
  "clipPath",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feMerge",
  "feMergeNode",
  "feColorMatrix",
  "feFlood",
  "feComposite",
  "title",
  "desc",
]);

const isPureSvgPrimitiveJsxName = (jsxOpeningName: EsTreeNode): boolean => {
  if (!isNodeOfType(jsxOpeningName, "JSXIdentifier")) return false;
  return PURE_SVG_PRIMITIVE_TAGS.has(jsxOpeningName.name);
};

// Recognises `<React.Fragment>` / `<Fragment>` / shorthand `<>` —
// fragments carry no DOM identity and no internal state, so an index
// key has no reordering hazard. (React would warn loudly if a key
// mismatch corrupted hooks, but fragments themselves can't hold any.)
const isFragmentJsxName = (jsxOpeningName: EsTreeNode): boolean => {
  if (isNodeOfType(jsxOpeningName, "JSXIdentifier")) {
    return jsxOpeningName.name === "Fragment";
  }
  if (
    isNodeOfType(jsxOpeningName, "JSXMemberExpression") &&
    isNodeOfType(jsxOpeningName.object, "JSXIdentifier") &&
    isNodeOfType(jsxOpeningName.property, "JSXIdentifier") &&
    jsxOpeningName.object.name === "React" &&
    jsxOpeningName.property.name === "Fragment"
  ) {
    return true;
  }
  return false;
};

// Port of `oxc_linter::rules::react::no_array_index_key`.
export const noArrayIndexKey = defineRule<Rule>({
  id: "no-array-index-key",
  severity: "warn",
  recommendation: "Use a stable, data-derived `key` instead of the array index.",
  category: "Performance",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const keyAttribute = hasJsxPropIgnoreCase(node.attributes, "key");
      if (!keyAttribute) return;
      if (!keyAttribute.value || !isNodeOfType(keyAttribute.value, "JSXExpressionContainer")) {
        return;
      }
      const expression = keyAttribute.value.expression as EsTreeNode;
      if (expression.type === "JSXEmptyExpression") return;
      // Fragments don't hold state or DOM identity — even if the key
      // is the index, React's reconciler only uses it to match
      // children at the same position, and a fragment misidentification
      // has no observable consequence.
      if (isFragmentJsxName(node.name as EsTreeNode)) return;
      // SVG primitives (`<g>`, `<path>`, `<line>`, …) have no DOM
      // state to corrupt; reorders just re-diff attributes.
      if (isPureSvgPrimitiveJsxName(node.name as EsTreeNode)) return;
      const indexBinding = findIndexParameterBinding(node as EsTreeNode);
      if (!indexBinding) return;
      if (!expressionUsesIndex(expression, indexBinding.name)) return;
      // Composite key with iterator member identity: `${item.id}-${index}`
      // — the index is just a defensive uniqueness fallback, the real
      // identity is `item.id`. Skip.
      if (isNodeOfType(expression, "TemplateLiteral")) {
        const itemName = findIteratorItemName(node as EsTreeNode);
        if (itemName && templateHasIteratorMember(expression, itemName)) return;
      }
      context.report({ node: keyAttribute, message: MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactCloneElement(node)) return;
      if (node.arguments.length < 2 || node.arguments.length > 3) return;
      const propsArgument = node.arguments[1] as EsTreeNode;
      if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
      const indexBinding = findIndexParameterBinding(node as EsTreeNode);
      if (!indexBinding) return;
      for (const property of propsArgument.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        if (property.computed) continue;
        const propKey = property.key as EsTreeNode;
        let propName: string | null = null;
        if (isNodeOfType(propKey, "Identifier")) propName = propKey.name;
        else if (isNodeOfType(propKey, "Literal") && typeof propKey.value === "string") {
          propName = propKey.value;
        }
        if (propName !== "key") continue;
        if (expressionUsesIndex(property.value as EsTreeNode, indexBinding.name)) {
          context.report({ node: property, message: MESSAGE });
        }
      }
    },
  }),
});
