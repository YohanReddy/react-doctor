import type { RuleSeverityControls, RuleSeverityOverride } from "@react-doctor/types";

interface RuleOverrideLookupInput {
  ruleKey: string;
  category?: string;
  tags?: ReadonlyArray<string>;
}

// Higher rank = more permissive. When multiple tag overrides match the
// same rule, the most permissive wins so silencing via any matching
// tag is always honored.
const SEVERITY_RANK: Record<RuleSeverityOverride, number> = { error: 0, warn: 1, off: 2 };

const isMorePermissive = (
  candidate: RuleSeverityOverride,
  current: RuleSeverityOverride | undefined,
): boolean => current === undefined || SEVERITY_RANK[candidate] > SEVERITY_RANK[current];

/**
 * Resolves the user-configured severity override for a rule.
 *
 * Lookup precedence (most specific first):
 *
 * 1. `rules["<plugin>/<rule>"]` — explicit per-rule override.
 * 2. `categories["<Category>"]` — category match.
 * 3. `tags["<tag>"]` — every behavioral tag the rule carries; when
 *    multiple tag overrides apply, the most permissive wins
 *    (`"off"` > `"warn"` > `"error"`).
 *
 * Returns `undefined` when no override applies — callers should
 * fall back to the rule's built-in severity.
 */
export const resolveRuleSeverityOverride = (
  input: RuleOverrideLookupInput,
  overrides: RuleSeverityControls | undefined,
): RuleSeverityOverride | undefined => {
  if (!overrides) return undefined;

  const fromRule = overrides.rules?.[input.ruleKey];
  if (fromRule !== undefined) return fromRule;

  if (input.category !== undefined) {
    const fromCategory = overrides.categories?.[input.category];
    if (fromCategory !== undefined) return fromCategory;
  }

  if (!input.tags || !overrides.tags) return undefined;
  let mostPermissive: RuleSeverityOverride | undefined;
  for (const tag of input.tags) {
    const candidate = overrides.tags[tag];
    if (candidate !== undefined && isMorePermissive(candidate, mostPermissive)) {
      mostPermissive = candidate;
    }
  }
  return mostPermissive;
};
