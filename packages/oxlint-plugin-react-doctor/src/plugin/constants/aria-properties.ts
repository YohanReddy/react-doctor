// Ported from oxc_linter::globals::AriaProperty. Each entry's
// expected value type is from the WAI-ARIA spec.

type AriaPropertyType =
  | "boolean"
  | "string"
  | "id"
  | "idlist"
  | "integer"
  | "number"
  | "token"
  | "tokenlist"
  | "tristate"
  | "true-false"
  | "true-false-undefined";

interface AriaPropertyDescriptor {
  readonly type: AriaPropertyType;
  // For `token` / `tokenlist` props, the allowed token values.
  readonly allowedTokens?: ReadonlyArray<string>;
}

// All WAI-ARIA properties + states. Keys are the full attribute name
// (including the `aria-` prefix). Mirrors the AriaProperty enum + the
// aria-query npm package.
export const ARIA_PROPERTIES: ReadonlyMap<string, AriaPropertyDescriptor> = new Map([
  ["aria-activedescendant", { type: "id" }],
  ["aria-atomic", { type: "boolean" }],
  ["aria-autocomplete", { type: "token", allowedTokens: ["inline", "list", "both", "none"] }],
  ["aria-braillelabel", { type: "string" }],
  ["aria-brailleroledescription", { type: "string" }],
  ["aria-busy", { type: "boolean" }],
  ["aria-checked", { type: "tristate" }],
  ["aria-colcount", { type: "integer" }],
  ["aria-colindex", { type: "integer" }],
  ["aria-colspan", { type: "integer" }],
  ["aria-controls", { type: "idlist" }],
  [
    "aria-current",
    {
      type: "token",
      allowedTokens: ["page", "step", "location", "date", "time", "true", "false"],
    },
  ],
  ["aria-describedby", { type: "idlist" }],
  ["aria-description", { type: "string" }],
  ["aria-details", { type: "id" }],
  ["aria-disabled", { type: "boolean" }],
  [
    "aria-dropeffect",
    {
      type: "tokenlist",
      allowedTokens: ["copy", "execute", "link", "move", "none", "popup"],
    },
  ],
  ["aria-errormessage", { type: "id" }],
  ["aria-expanded", { type: "true-false-undefined" }],
  ["aria-flowto", { type: "idlist" }],
  ["aria-grabbed", { type: "true-false-undefined" }],
  [
    "aria-haspopup",
    {
      type: "token",
      allowedTokens: ["false", "true", "menu", "listbox", "tree", "grid", "dialog"],
    },
  ],
  ["aria-hidden", { type: "true-false-undefined" }],
  ["aria-invalid", { type: "token", allowedTokens: ["grammar", "false", "spelling", "true"] }],
  ["aria-keyshortcuts", { type: "string" }],
  ["aria-label", { type: "string" }],
  ["aria-labelledby", { type: "idlist" }],
  ["aria-level", { type: "integer" }],
  ["aria-live", { type: "token", allowedTokens: ["assertive", "off", "polite"] }],
  ["aria-modal", { type: "boolean" }],
  ["aria-multiline", { type: "boolean" }],
  ["aria-multiselectable", { type: "boolean" }],
  ["aria-orientation", { type: "token", allowedTokens: ["horizontal", "undefined", "vertical"] }],
  ["aria-owns", { type: "idlist" }],
  ["aria-placeholder", { type: "string" }],
  ["aria-posinset", { type: "integer" }],
  ["aria-pressed", { type: "tristate" }],
  ["aria-readonly", { type: "boolean" }],
  [
    "aria-relevant",
    {
      type: "tokenlist",
      allowedTokens: ["additions", "all", "removals", "text"],
    },
  ],
  ["aria-required", { type: "boolean" }],
  ["aria-roledescription", { type: "string" }],
  ["aria-rowcount", { type: "integer" }],
  ["aria-rowindex", { type: "integer" }],
  ["aria-rowspan", { type: "integer" }],
  ["aria-selected", { type: "true-false-undefined" }],
  ["aria-setsize", { type: "integer" }],
  ["aria-sort", { type: "token", allowedTokens: ["ascending", "descending", "none", "other"] }],
  ["aria-valuemax", { type: "number" }],
  ["aria-valuemin", { type: "number" }],
  ["aria-valuenow", { type: "number" }],
  ["aria-valuetext", { type: "string" }],
]);

export const isValidAriaProperty = (name: string): boolean => ARIA_PROPERTIES.has(name);
