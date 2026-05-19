import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "../../utils/is-on-intrinsic-html-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "JSX prop receives a new Object on every render — extract it or memoize to avoid re-renders.";

// Props that ALWAYS receive a fresh object by React's API contract —
// flagging them is unactionable noise. `dangerouslySetInnerHTML` MUST be
// `{ __html: ... }`; `style` is the documented React inline-style API
// and inlining is idiomatic for one-shot components where memo perf is
// irrelevant. Suppress both regardless of the wrapping component.
const ALWAYS_FRESH_OBJECT_PROPS: ReadonlySet<string> = new Set([
  "dangerouslySetInnerHTML",
  "style",
]);

// Configuration-shape prop names that conventionally receive an
// inline object literal (one-time setup, not a hot-path value). Every
// design system / chart library / animation library defines these:
// flagging them creates massive noise for library consumers without
// any actionable signal.
const CONFIG_OBJECT_PROP_NAMES: ReadonlySet<string> = new Set([
  // Generic config slots
  "options",
  "config",
  "settings",
  "params",
  "input",
  "value",
  "values",
  "data",
  "metadata",
  // Component / element slot configs
  "components",
  "customComponents",
  "slots",
  "elements",
  // Style / theme / className configs
  "classNames",
  "theme",
  "styles",
  "sx",
  "css",
  // Layout configs (chart / canvas libs)
  "margin",
  "padding",
  "viewport",
  "viewBox",
  "bounds",
  "extent",
  "domain",
  "range",
  // Animation / motion configs (framer-motion, react-spring, etc.)
  "animate",
  "initial",
  "exit",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "drag",
  "dragConstraints",
  // Tldraw / Excalidraw / library-specific
  "UIOptions",
  "renderConfig",
  "shape",
  "shapes",
  "user",
  "users",
  // Common object-shape slot/feature props
  "args",
  "avatar",
  "dot",
  "action",
  "expandable",
  "defaultSort",
  "resourceType",
  "truncateText",
  "formatters",
  "label",
  // Generic single-record / config / query props
  "context",
  "query",
  "props",
  "pagination",
  "filters",
  "person",
  "command",
  "cursor",
  "payload",
  "tooltip",
  "properties",
  "metadataSource",
  "queryParams",
  "extraQueryParams",
  "selectedOption",
  "emptyOption",
  "pinnedOption",
  "excludedProperties",
  "disabledReasons",
  "fallbackApplicationData",
  "fieldMetadataItem",
  "contextDescription",
  "emptyMessage",
  "defaultSorting",
  "defaultValue",
  "dropdown",
  "sideAction",
  "dropdownOffset",
  "collisionPadding",
  "forceBackTo",
]);

// Suffixes that mark a prop as a "config object" by convention —
// `*Props` (Radix / MUI / shadcn pass-through props), `*Config`,
// `*Configuration`, `*Options`, `*Settings`, `*Style`, `*ClassName`,
// `*Sort`, `*Filter`, `*Pagination`, `*Format`, `*Locale`,
// `*Validator`, `*Args`.
const CONFIG_OBJECT_PROP_SUFFIXES: ReadonlyArray<string> = [
  "Props",
  "Config",
  "Configuration",
  "Options",
  "Settings",
  "Style",
  "Styles",
  "ClassName",
  "ClassNames",
  "Theme",
  "Sort",
  "Sorting",
  "Filter",
  "Pagination",
  "Format",
  "Locale",
  "Validator",
  "Args",
  "Type",
  // Generic singular-record / option / metadata / context suffixes
  "Item",
  "Option",
  "Record",
  "Metadata",
  "Context",
  "Query",
  "Source",
  "Target",
  "Action",
  "Properties",
  "Property",
  "Reasons",
  "Reason",
  "Padding",
  "Margin",
  "Offset",
  "Position",
  "Placement",
  "Value",
  "Defaults",
  "Default",
  "Schema",
  "Payload",
  "Cursor",
  "Tooltip",
];

const isConfigObjectPropName = (propName: string): boolean => {
  if (CONFIG_OBJECT_PROP_NAMES.has(propName)) return true;
  for (const suffix of CONFIG_OBJECT_PROP_SUFFIXES) {
    if (propName.length > suffix.length && propName.endsWith(suffix)) return true;
  }
  return false;
};

const OBJECT_CONSTRUCTOR_NAMES = new Set(["Object"]);
const OBJECT_PRODUCING_METHODS = new Set([
  "assign",
  "create",
  "fromEntries",
  "groupBy",
  "freeze",
  "seal",
]);

const isObjectProducingExpression = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ObjectExpression")) return true;
  if (isNodeOfType(stripped, "NewExpression")) {
    return (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    );
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    if (
      isNodeOfType(stripped.callee, "Identifier") &&
      OBJECT_CONSTRUCTOR_NAMES.has(stripped.callee.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(stripped.callee, "MemberExpression") &&
      isNodeOfType(stripped.callee.object, "Identifier") &&
      stripped.callee.object.name === "Object" &&
      isNodeOfType(stripped.callee.property, "Identifier") &&
      OBJECT_PRODUCING_METHODS.has(stripped.callee.property.name)
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      isObjectProducingExpression(stripped.left) || isObjectProducingExpression(stripped.right)
    );
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      isObjectProducingExpression(stripped.consequent) ||
      isObjectProducingExpression(stripped.alternate)
    );
  }
  return false;
};

const followsRenderLocalObjectBinding = (
  expression: EsTreeNode,
  jsxAttribute: EsTreeNode,
): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding || !binding.initializer) return false;
  let walker: EsTreeNode | null = jsxAttribute;
  while (walker) {
    if (walker === binding.scopeOwner) {
      if (binding.scopeOwner.type === "Program") return false;
      break;
    }
    walker = walker.parent ?? null;
  }
  return isObjectProducingExpression(binding.initializer);
};

// Port of `oxc_linter::rules::react_perf::jsx_no_new_object_as_prop`.
// See `jsx-no-new-array-as-prop` for the shared shape; this one flags
// ObjectExpression / new Object() / Object.assign() / Object.create()
// etc. and the same conditional / logical wrappings. LIMITATION: same
// scope-analysis gap noted there.
export const jsxNoNewObjectAsProp = defineRule<Rule>({
  id: "jsx-no-new-object-as-prop",
  severity: "warn",
  // React Compiler auto-memoizes prop allocations, so the perf footgun
  // this rule guards against doesn't exist in compiler-enabled projects.
  disabledBy: ["react-compiler"],
  recommendation: "Memoize the object (`useMemo`) or hoist it outside the component.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        // Intrinsic HTML elements aren't memoized; flagging inline
        // object literals on them is unactionable. See the same skip
        // in `jsx-no-new-function-as-prop` for the full rationale.
        if (isJsxAttributeOnIntrinsicHtmlElement(node)) return;
        if (!isInsideFunctionScope(node)) return;
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        if (ALWAYS_FRESH_OBJECT_PROPS.has(node.name.name)) return;
        // Configuration-shape props (`options`, `config`, `theme`,
        // `wrapperProps`, etc. + `*Props` / `*Config` / `*Options`
        // suffixes) receive inline literals by design — chart libs,
        // animation libs, design systems all use this pattern. The
        // perf footgun the rule targets is hot-path identity changes;
        // config slots aren't that.
        if (isConfigObjectPropName(node.name.name)) return;
        const value = node.value;
        if (!value || !isNodeOfType(value, "JSXExpressionContainer")) return;
        const expression = value.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        const expressionNode = expression as EsTreeNode;
        if (
          !isObjectProducingExpression(expressionNode) &&
          !followsRenderLocalObjectBinding(expressionNode, node)
        ) {
          return;
        }
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
