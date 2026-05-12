import type { EsTreeNode } from "./es-tree-node.js";
import { isCookiesOrHeadersCall } from "./is-cookies-or-headers-call.js";
import { isMutatingDbCall } from "./is-mutating-db-call.js";
import { isMutatingFetchCall } from "./is-mutating-fetch-call.js";
import { isMutatingMethodProperty } from "./is-mutating-method-property.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const HEADER_BINDING_NAMES = new Set(["headers", "responseHeaders", "resHeaders"]);
const HEADER_MUTATION_METHOD_NAMES = new Set(["append", "delete", "set"]);

const isIdentifierNamed = (node: EsTreeNode, names: ReadonlySet<string>): boolean =>
  isNodeOfType(node, "Identifier") && names.has(node.name);

const isOutboundHeadersMutationCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }
  const { object, property } = node.callee;
  if (!isIdentifierNamed(property, HEADER_MUTATION_METHOD_NAMES)) return false;
  if (isIdentifierNamed(object, HEADER_BINDING_NAMES)) return true;
  return (
    isNodeOfType(object, "MemberExpression") &&
    isIdentifierNamed(object.property, HEADER_BINDING_NAMES)
  );
};

export const findSideEffect = (node: EsTreeNode): string | null => {
  let sideEffectDescription: string | null = null;
  walkAst(node, (child: EsTreeNode) => {
    if (sideEffectDescription) return;
    if (isOutboundHeadersMutationCall(child)) {
      return;
    }
    if (isCookiesOrHeadersCall(child, "cookies")) {
      const methodName = child.callee.property.name;
      sideEffectDescription = `cookies().${methodName}()`;
    } else if (isCookiesOrHeadersCall(child, "headers")) {
      const methodName = child.callee.property.name;
      sideEffectDescription = `headers().${methodName}()`;
    } else if (isMutatingFetchCall(child)) {
      // HACK: re-use the EXACT predicate `isMutatingFetchCall` already
      // matched on so we can't pick a non-Literal duplicate `method:`
      // entry by mistake (a looser `key.name === "method"` predicate
      // would).
      const methodProperty = child.arguments[1].properties.find(isMutatingMethodProperty);
      sideEffectDescription = `fetch() with method ${methodProperty.value.value}`;
    } else if (isMutatingDbCall(child)) {
      const methodName = child.callee.property.name;
      const objectName = isNodeOfType(child.callee.object, "Identifier")
        ? child.callee.object.name
        : null;
      sideEffectDescription = objectName ? `${objectName}.${methodName}()` : `.${methodName}()`;
    }
  });
  return sideEffectDescription;
};
