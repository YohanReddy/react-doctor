import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { MAX_EXPRESSION_SNIPPET_ITEMS_COUNT } from "./constants.js";

// Small AST snippet → string formatter used by `no-initialize-state` so
// the diagnostic can suggest `useState("Dr. " + name)` rather than just
// referencing the position. Conservative on purpose — anything we don't
// recognize falls back to `<expression>` so the message stays bounded.
//
// Not a full pretty-printer; we deliberately do not chase MemberExpression
// computed keys, AssignmentExpressions, ConditionalExpressions, or
// arbitrary nesting beyond a few common shapes.
const FALLBACK = "<expression>";

const stringifyLiteral = (literal: { value?: unknown; raw?: string }): string => {
  if (typeof literal.raw === "string") return literal.raw;
  if (literal.value === null) return "null";
  if (typeof literal.value === "string") return JSON.stringify(literal.value);
  if (typeof literal.value === "number") return String(literal.value);
  if (typeof literal.value === "boolean") return String(literal.value);
  return FALLBACK;
};

const stringifyTemplateLiteral = (node: EsTreeNode): string => {
  if (!isNodeOfType(node, "TemplateLiteral")) return FALLBACK;
  const quasis = node.quasis ?? [];
  const expressions = node.expressions ?? [];
  let out = "`";
  for (let i = 0; i < quasis.length; i += 1) {
    out += quasis[i].value?.cooked ?? quasis[i].value?.raw ?? "";
    if (i < expressions.length) {
      out += "${" + stringifyExpressionSnippet(expressions[i]) + "}";
    }
  }
  out += "`";
  return out;
};

export const stringifyExpressionSnippet = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "undefined";
  if (isNodeOfType(node, "Literal")) return stringifyLiteral(node);
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "TemplateLiteral")) return stringifyTemplateLiteral(node);
  if (isNodeOfType(node, "MemberExpression")) {
    if (
      isNodeOfType(node.object, "Identifier") &&
      isNodeOfType(node.property, "Identifier") &&
      !node.computed
    ) {
      return `${node.object.name}.${node.property.name}`;
    }
    return FALLBACK;
  }
  if (isNodeOfType(node, "CallExpression")) {
    const calleeText = isNodeOfType(node.callee, "Identifier")
      ? node.callee.name
      : isNodeOfType(node.callee, "MemberExpression") &&
          isNodeOfType(node.callee.object, "Identifier") &&
          isNodeOfType(node.callee.property, "Identifier") &&
          !node.callee.computed
        ? `${node.callee.object.name}.${node.callee.property.name}`
        : FALLBACK;
    const argText = (node.arguments ?? [])
      .slice(0, MAX_EXPRESSION_SNIPPET_ITEMS_COUNT)
      .map((argument) => stringifyExpressionSnippet(argument as EsTreeNode))
      .join(", ");
    const suffix =
      (node.arguments?.length ?? 0) > MAX_EXPRESSION_SNIPPET_ITEMS_COUNT ? ", ..." : "";
    return `${calleeText}(${argText}${suffix})`;
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    const items = (node.elements ?? [])
      .slice(0, MAX_EXPRESSION_SNIPPET_ITEMS_COUNT)
      .map((element) => (element ? stringifyExpressionSnippet(element) : "<hole>"))
      .join(", ");
    const suffix = (node.elements?.length ?? 0) > MAX_EXPRESSION_SNIPPET_ITEMS_COUNT ? ", ..." : "";
    return `[${items}${suffix}]`;
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    if ((node.properties?.length ?? 0) === 0) return "{}";
    return "{ ... }";
  }
  if (isNodeOfType(node, "ArrowFunctionExpression")) return "() => ...";
  if (isNodeOfType(node, "FunctionExpression")) return "function () { ... }";
  if (isNodeOfType(node, "BinaryExpression") || isNodeOfType(node, "LogicalExpression")) {
    const left = stringifyExpressionSnippet(node.left);
    const right = stringifyExpressionSnippet(node.right);
    return `${left} ${node.operator} ${right}`;
  }
  if (isNodeOfType(node, "UnaryExpression")) {
    return `${node.operator}${stringifyExpressionSnippet(node.argument)}`;
  }
  return FALLBACK;
};
