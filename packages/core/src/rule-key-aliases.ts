const LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY: Readonly<Record<string, string>> = {
  "effect/no-derived-state": "react-doctor/no-derived-state",
  "effect/no-chain-state-updates": "react-doctor/no-chain-state-updates",
  "effect/no-event-handler": "react-doctor/no-event-handler",
  "effect/no-adjust-state-on-prop-change": "react-doctor/no-adjust-state-on-prop-change",
  "effect/no-reset-all-state-on-prop-change": "react-doctor/no-reset-all-state-on-prop-change",
  "effect/no-pass-live-state-to-parent": "react-doctor/no-pass-live-state-to-parent",
  "effect/no-pass-data-to-parent": "react-doctor/no-pass-data-to-parent",
  "effect/no-initialize-state": "react-doctor/no-initialize-state",
  "react/rules-of-hooks": "react-doctor/rules-of-hooks",
  "react/no-direct-mutation-state": "react-doctor/no-direct-mutation-state",
  "react/jsx-no-duplicate-props": "react-doctor/jsx-no-duplicate-props",
  "react/jsx-key": "react-doctor/jsx-key",
  "react/no-children-prop": "react-doctor/no-children-prop",
  "react/no-danger": "react-doctor/no-danger",
  "react/jsx-no-script-url": "react-doctor/jsx-no-script-url",
  "react/no-render-return-value": "react-doctor/no-render-return-value",
  "react/no-string-refs": "react-doctor/no-string-refs",
  "react/no-is-mounted": "react-doctor/no-is-mounted",
  "react/require-render-return": "react-doctor/require-render-return",
  "react/no-unknown-property": "react-doctor/no-unknown-property",
  "jsx-a11y/alt-text": "react-doctor/alt-text",
  "jsx-a11y/anchor-is-valid": "react-doctor/anchor-is-valid",
  "jsx-a11y/click-events-have-key-events": "react-doctor/click-events-have-key-events",
  "jsx-a11y/no-static-element-interactions": "react-doctor/no-static-element-interactions",
  "jsx-a11y/role-has-required-aria-props": "react-doctor/role-has-required-aria-props",
  "jsx-a11y/no-autofocus": "react-doctor/no-autofocus",
  "jsx-a11y/heading-has-content": "react-doctor/heading-has-content",
  "jsx-a11y/html-has-lang": "react-doctor/html-has-lang",
  "jsx-a11y/no-redundant-roles": "react-doctor/no-redundant-roles",
  "jsx-a11y/scope": "react-doctor/scope",
  "jsx-a11y/tabindex-no-positive": "react-doctor/tabindex-no-positive",
  "jsx-a11y/label-has-associated-control": "react-doctor/label-has-associated-control",
  "jsx-a11y/no-distracting-elements": "react-doctor/no-distracting-elements",
  "jsx-a11y/iframe-has-title": "react-doctor/iframe-has-title",
};

const NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS = new Map<string, string[]>();
for (const [legacyRuleKey, nativeRuleKey] of Object.entries(LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY)) {
  const aliases = NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.get(nativeRuleKey) ?? [];
  aliases.push(legacyRuleKey);
  NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.set(nativeRuleKey, aliases);
}

export const getLegacyRuleKeysForNative = (ruleKey: string): ReadonlyArray<string> =>
  NATIVE_RULE_KEY_TO_LEGACY_RULE_KEYS.get(ruleKey) ?? [];

const canonicalizeRuleKey = (ruleKey: string): string =>
  LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY[ruleKey] ?? ruleKey;

export const isSameRuleKey = (candidateRuleKey: string, targetRuleKey: string): boolean =>
  canonicalizeRuleKey(candidateRuleKey) === canonicalizeRuleKey(targetRuleKey);

export const getEquivalentRuleKeys = (ruleKey: string): ReadonlyArray<string> => {
  const nativeRuleKey = canonicalizeRuleKey(ruleKey);
  return [nativeRuleKey, ...getLegacyRuleKeysForNative(nativeRuleKey)];
};
