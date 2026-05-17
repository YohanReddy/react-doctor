import { isValidDomAriaProperty } from "../../constants/dom-aria-properties.js";
import {
  DOM_ATTRIBUTES_TO_CAMEL,
  DOM_PROPERTIES_IGNORE_CASE,
  DOM_PROPERTY_NAMES,
  DOM_PROPERTY_NAMES_LOWER,
} from "../../constants/dom-property-names.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../constants/dom-property-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

interface NoUnknownPropertySettings {
  ignore?: ReadonlyArray<string>;
  requireDataLowercase?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): NoUnknownPropertySettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  return (reactDoctor as { noUnknownProperty?: NoUnknownPropertySettings }).noUnknownProperty ?? {};
};

// Mirrors the Rust `is_valid_data_attr` predicate: starts with `data-`,
// not `data-xml*`, has a non-empty name segment, and contains no `:`.
const isValidDataAttribute = (attributeName: string): boolean => {
  if (!attributeName.startsWith("data-")) return false;
  if (attributeName.toLowerCase().startsWith("data-xml")) return false;
  const dataName = attributeName.slice("data-".length);
  if (dataName.length === 0) return false;
  return !dataName.includes(":");
};

const matchesHtmlTagConventions = (tagName: string): boolean => {
  if (tagName.length === 0) return false;
  const firstCharacter = tagName.charCodeAt(0);
  const isAsciiLowercase = firstCharacter >= 97 && firstCharacter <= 122;
  if (!isAsciiLowercase) return false;
  return !tagName.includes("-");
};

const normalizeAttributeCase = (name: string): string => {
  for (const ignoreCaseName of DOM_PROPERTIES_IGNORE_CASE) {
    if (ignoreCaseName.toLowerCase() === name.toLowerCase()) return ignoreCaseName;
  }
  return name;
};

const hasUppercaseChar = (input: string): boolean => /[A-Z]/.test(input);

const INVALID_PROP_ON_TAG = (propName: string, allowedTags: string): string =>
  `Invalid property — \`${propName}\` is only allowed on: ${allowedTags}`;
const DATA_LOWERCASE_REQUIRED = (suggestedProp: string): string =>
  `\`data-*\` props with uppercase characters aren't recognized — use \`${suggestedProp}\` instead.`;
const UNKNOWN_PROP_WITH_STANDARD_NAME = (suggested: string): string =>
  `Unknown property — use \`${suggested}\` instead.`;
const UNKNOWN_PROP_GENERIC = "Unknown property — remove it.";

// Port of `oxc_linter::rules::react::no_unknown_property`. Validates JSX
// attributes against React's recognized DOM/SVG attribute set:
//   - `aria-*` must be a valid ARIA property name.
//   - `data-*` must follow the kebab-case lowercase convention; with
//     `requireDataLowercase` setting, uppercase chars are also flagged.
//   - Non-data, non-aria attrs on a known HTML tag must be in
//     `DOM_PROPERTY_NAMES`. Unknown ones get suggestions when the
//     lowercase form maps back to a known camelCase name (`onclick` →
//     `onClick`) or when an HTML attribute has a known camel form
//     (`class` → `className`).
//   - Tag-restricted attrs (`fetchPriority`, `viewBox`, `download`, …)
//     are flagged on tags outside their allowed set.
// Custom elements (`<my-elem>`, anything with `is="..."`) are skipped.
export const noUnknownProperty = defineRule<Rule>({
  id: "no-unknown-property",
  severity: "warn",
  recommendation:
    "Use the React-cased prop name React expects (`className`, `htmlFor`, `tabIndex`, …).",
  create: (context) => {
    const { ignore = [], requireDataLowercase = false } = resolveSettings(context.settings);
    const ignoreSet = new Set(ignore);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const elementType = node.name.name;
        const firstCharacter = elementType.charCodeAt(0);
        const isLowercaseStart = firstCharacter >= 97 && firstCharacter <= 122;
        if (!isLowercaseStart || elementType === "fbt" || elementType === "fbs") return;

        let isValidHtmlTag = matchesHtmlTagConventions(elementType);
        if (isValidHtmlTag) {
          for (const attribute of node.attributes) {
            if (!isNodeOfType(attribute, "JSXAttribute")) continue;
            if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
            if (attribute.name.name === "is") {
              isValidHtmlTag = false;
              break;
            }
          }
        }

        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const actualName = getJsxAttributeName(attribute.name);
          if (!actualName) continue;
          if (ignoreSet.has(actualName)) continue;

          if (isValidDataAttribute(actualName)) {
            if (requireDataLowercase && hasUppercaseChar(actualName)) {
              context.report({
                node: attribute.name,
                message: DATA_LOWERCASE_REQUIRED(actualName.toLowerCase()),
              });
            }
            continue;
          }

          if (isValidDomAriaProperty(actualName)) continue;
          if (!isValidHtmlTag) continue;

          const normalizedName = normalizeAttributeCase(actualName);
          const allowedTags = DOM_PROPERTY_TO_ALLOWED_TAGS.get(normalizedName);
          if (allowedTags) {
            if (!allowedTags.has(elementType)) {
              context.report({
                node: attribute.name,
                message: INVALID_PROP_ON_TAG(actualName, [...allowedTags].join(", ")),
              });
            }
            continue;
          }

          if (DOM_PROPERTY_NAMES.has(normalizedName)) continue;

          const lowercased = normalizedName.toLowerCase();
          const suggestion =
            DOM_PROPERTY_NAMES_LOWER.get(lowercased) ?? DOM_ATTRIBUTES_TO_CAMEL.get(normalizedName);
          if (suggestion) {
            context.report({
              node: attribute.name,
              message: UNKNOWN_PROP_WITH_STANDARD_NAME(suggestion),
            });
          } else {
            context.report({ node: attribute.name, message: UNKNOWN_PROP_GENERIC });
          }
        }
      },
    };
  },
});
