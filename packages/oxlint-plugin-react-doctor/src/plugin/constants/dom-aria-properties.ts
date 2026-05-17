// Ported from `oxc_linter::globals::AriaProperty` constants — the full
// list of `aria-*` attribute names supported by ARIA 1.2. Stored
// lowercase, matched against the suffix after `aria-` lower-cased.
export const ARIA_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "activedescendant",
  "atomic",
  "autocomplete",
  "braillelabel",
  "brailleroledescription",
  "busy",
  "checked",
  "colcount",
  "colindex",
  "colspan",
  "controls",
  "current",
  "describedby",
  "description",
  "details",
  "disabled",
  "dropeffect",
  "errormessage",
  "expanded",
  "flowto",
  "grabbed",
  "haspopup",
  "hidden",
  "invalid",
  "keyshortcuts",
  "label",
  "labelledby",
  "level",
  "live",
  "modal",
  "multiline",
  "multiselectable",
  "orientation",
  "owns",
  "placeholder",
  "posinset",
  "pressed",
  "readonly",
  "relevant",
  "required",
  "roledescription",
  "rowcount",
  "rowindex",
  "rowspan",
  "selected",
  "setsize",
  "sort",
  "valuemax",
  "valuemin",
  "valuenow",
  "valuetext",
]);

// Case-insensitive variant of the spec-strict `isValidAriaProperty`
// (see `./aria-properties.ts`). HTML attribute names are
// case-insensitive, so JSX like `<div aria-LABEL="…" />` should still
// be considered valid by the `no-unknown-property` rule. The
// spec-strict (case-sensitive) variant continues to live in
// `aria-properties.ts` for `aria-props`'s exact-match check.
export const isValidDomAriaProperty = (name: string): boolean => {
  const ARIA_PREFIX = "aria-";
  if (!name.startsWith(ARIA_PREFIX)) return false;
  const suffix = name.slice(ARIA_PREFIX.length).toLowerCase();
  return ARIA_PROPERTY_NAMES.has(suffix);
};
