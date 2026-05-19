import { reactDoctorRules } from "./plugin/rule-registry.js";
import type { RuleFramework } from "./plugin/utils/rule.js";
import type { OxlintRuleSeverity } from "./types.js";

interface RuleMapEntry {
  key: string;
  severity: OxlintRuleSeverity;
}

const toRuleMap = (rules: ReadonlyArray<RuleMapEntry>): Record<string, OxlintRuleSeverity> =>
  Object.fromEntries(rules.map((rule) => [rule.key, rule.severity]));

// Skips rules with `defaultEnabled: false` — these ship in the plugin
// for opt-in but are not part of any recommended preset. The oxlint
// config builder in `@react-doctor/core` honors this flag via the
// `severityControls` override path; presets exported from this package
// (used by the ESLint `recommended` flat config) must respect it too,
// or ESLint users would silently get every default-disabled rule.
const isRecommendedByDefault = (rule: (typeof reactDoctorRules)[number]): boolean =>
  rule.rule.defaultEnabled !== false;

const collectReactDoctorRulesByFramework = (frameworkName: RuleFramework) =>
  reactDoctorRules.filter(
    (rule) => rule.framework === frameworkName && isRecommendedByDefault(rule),
  );

const collectExternalRulesBySource = (source: string) =>
  EXTERNAL_RULES.filter((rule) => rule.source === source);

const collectFrameworkSpecificRuleKeys = (): ReadonlySet<string> => {
  const collected = new Set<string>();
  for (const rule of reactDoctorRules) {
    if (rule.framework !== "global") collected.add(rule.key);
  }
  return collected;
};

export const REACT_DOCTOR_RULES = reactDoctorRules;

// Only React Compiler rules remain external. The previous
// `react/*`, `jsx-a11y/*`, and `effect/*` entries are now natively
// ported into this package and ship through `REACT_DOCTOR_RULES`.
export const EXTERNAL_RULES = [
  { key: "react-hooks-js/set-state-in-render", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/immutability", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/refs", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/purity", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/hooks", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/set-state-in-effect", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/globals", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/error-boundaries", source: "react-compiler", severity: "error" },
  {
    key: "react-hooks-js/preserve-manual-memoization",
    source: "react-compiler",
    severity: "error",
  },
  { key: "react-hooks-js/unsupported-syntax", source: "react-compiler", severity: "error" },
  {
    key: "react-hooks-js/component-hook-factories",
    source: "react-compiler",
    severity: "error",
  },
  { key: "react-hooks-js/static-components", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/void-use-memo", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/incompatible-library", source: "react-compiler", severity: "error" },
  { key: "react-hooks-js/todo", source: "react-compiler", severity: "error" },
] as const;

const YOU_MIGHT_NOT_NEED_EFFECT_NATIVE_RULES = [
  { key: "react-doctor/no-derived-state", severity: "warn" },
  { key: "react-doctor/no-chain-state-updates", severity: "warn" },
  { key: "react-doctor/no-event-handler", severity: "warn" },
  { key: "react-doctor/no-adjust-state-on-prop-change", severity: "warn" },
  { key: "react-doctor/no-reset-all-state-on-prop-change", severity: "warn" },
  { key: "react-doctor/no-pass-live-state-to-parent", severity: "warn" },
  { key: "react-doctor/no-pass-data-to-parent", severity: "warn" },
  { key: "react-doctor/no-initialize-state", severity: "warn" },
] as const;

const BUILTIN_REACT_NATIVE_RULES = [
  { key: "react-doctor/rules-of-hooks", severity: "error" },
  { key: "react-doctor/no-direct-mutation-state", severity: "error" },
  { key: "react-doctor/jsx-no-duplicate-props", severity: "error" },
  { key: "react-doctor/jsx-key", severity: "error" },
  { key: "react-doctor/no-children-prop", severity: "warn" },
  { key: "react-doctor/no-danger", severity: "warn" },
  { key: "react-doctor/jsx-no-script-url", severity: "error" },
  { key: "react-doctor/no-render-return-value", severity: "warn" },
  { key: "react-doctor/no-string-refs", severity: "warn" },
  { key: "react-doctor/no-is-mounted", severity: "warn" },
  { key: "react-doctor/require-render-return", severity: "error" },
  { key: "react-doctor/no-unknown-property", severity: "warn" },
] as const;

const BUILTIN_A11Y_NATIVE_RULES = [
  { key: "react-doctor/alt-text", severity: "error" },
  { key: "react-doctor/anchor-is-valid", severity: "warn" },
  { key: "react-doctor/click-events-have-key-events", severity: "warn" },
  { key: "react-doctor/no-static-element-interactions", severity: "warn" },
  { key: "react-doctor/role-has-required-aria-props", severity: "error" },
  { key: "react-doctor/no-autofocus", severity: "warn" },
  { key: "react-doctor/heading-has-content", severity: "warn" },
  { key: "react-doctor/html-has-lang", severity: "warn" },
  { key: "react-doctor/no-redundant-roles", severity: "warn" },
  { key: "react-doctor/scope", severity: "warn" },
  { key: "react-doctor/tabindex-no-positive", severity: "warn" },
  { key: "react-doctor/label-has-associated-control", severity: "warn" },
  { key: "react-doctor/no-distracting-elements", severity: "error" },
  { key: "react-doctor/iframe-has-title", severity: "warn" },
] as const;

export const RULES = [...REACT_DOCTOR_RULES, ...EXTERNAL_RULES] as const;

export const RECOMMENDED_RULES = toRuleMap(collectReactDoctorRulesByFramework("global"));
export const NEXTJS_RULES = toRuleMap(collectReactDoctorRulesByFramework("nextjs"));
export const REACT_NATIVE_RULES = toRuleMap(collectReactDoctorRulesByFramework("react-native"));
export const TANSTACK_START_RULES = toRuleMap(collectReactDoctorRulesByFramework("tanstack-start"));
export const TANSTACK_QUERY_RULES = toRuleMap(collectReactDoctorRulesByFramework("tanstack-query"));
export const ALL_REACT_DOCTOR_RULES = toRuleMap(REACT_DOCTOR_RULES);
export const ALL_REACT_DOCTOR_RULE_KEYS: ReadonlySet<string> = new Set(
  REACT_DOCTOR_RULES.map((rule) => rule.key),
);
export const FRAMEWORK_SPECIFIC_RULE_KEYS = collectFrameworkSpecificRuleKeys();
export const REACT_COMPILER_RULES = toRuleMap(collectExternalRulesBySource("react-compiler"));
export const YOU_MIGHT_NOT_NEED_EFFECT_RULES = toRuleMap(YOU_MIGHT_NOT_NEED_EFFECT_NATIVE_RULES);
export const BUILTIN_REACT_RULES = toRuleMap(BUILTIN_REACT_NATIVE_RULES);
export const BUILTIN_A11Y_RULES = toRuleMap(BUILTIN_A11Y_NATIVE_RULES);
