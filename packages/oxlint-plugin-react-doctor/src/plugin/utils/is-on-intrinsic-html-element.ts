import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True iff the JSXAttribute belongs to an intrinsic HTML element
// (`<div>`, `<button>`, `<input>`, ...) — i.e. a JSXIdentifier whose
// name starts with a lowercase letter. Used by the perf-rule family
// (`jsx-no-new-{object,array,function,jsx}-as-prop`) to skip flagging
// inline callbacks / objects / arrays passed to intrinsic elements:
// the browser doesn't memoize event listeners on DOM nodes and React
// doesn't `React.memo` HTML primitives, so the "new reference per
// render breaks memoization" footgun is unactionable here.
export const isJsxAttributeOnIntrinsicHtmlElement = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  const openingElement = attribute.parent;
  if (!openingElement) return false;
  if (!isNodeOfType(openingElement as EsTreeNode, "JSXOpeningElement")) return false;
  const elementName = (openingElement as EsTreeNodeOfType<"JSXOpeningElement">).name as EsTreeNode;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  const firstCharacterCode = elementName.name.charCodeAt(0);
  // lowercase ASCII a-z
  return firstCharacterCode >= 97 && firstCharacterCode <= 122;
};
