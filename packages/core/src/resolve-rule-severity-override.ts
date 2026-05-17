import type { RuleSeverityOverride, SeverityOverrideControls } from "@react-doctor/types";

interface RuleOverrideLookupInput {
  ruleKey: string;
  category?: string;
  tags?: ReadonlyArray<string>;
}

const SEVERITY_PERMISSIVENESS: Record<RuleSeverityOverride, number> = {
  off: 2,
  warn: 1,
  error: 0,
};

const pickMostPermissive = (
  current: RuleSeverityOverride | undefined,
  candidate: RuleSeverityOverride | undefined,
): RuleSeverityOverride | undefined => {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  return SEVERITY_PERMISSIVENESS[candidate] > SEVERITY_PERMISSIVENESS[current]
    ? candidate
    : current;
};

const collectTagOverride = (
  tags: ReadonlyArray<string> | undefined,
  tagOverrides: Record<string, RuleSeverityOverride> | undefined,
): RuleSeverityOverride | undefined => {
  if (!tags || tags.length === 0 || !tagOverrides) return undefined;
  let resolved: RuleSeverityOverride | undefined;
  for (const tagName of tags) {
    const candidate = tagOverrides[tagName];
    if (candidate === undefined) continue;
    resolved = pickMostPermissive(resolved, candidate);
  }
  return resolved;
};

/**
 * Resolves the user-configured severity override for a rule.
 *
 * Lookup precedence (most specific first):
 *
 * 1. `rules["<plugin>/<rule>"]` — explicit per-rule override.
 * 2. `categories["<Category>"]` — category match.
 * 3. `tags["<tag>"]` — every behavioral tag the rule carries; when
 *    multiple tag overrides apply, the most permissive wins
 *    (`"off"` > `"warn"` > `"error"`) so silencing via any tag
 *    is always honored.
 *
 * Returns `undefined` when no override applies — callers should
 * fall back to the rule's built-in severity.
 */
export const resolveRuleSeverityOverride = (
  input: RuleOverrideLookupInput,
  overrides: SeverityOverrideControls | undefined,
): RuleSeverityOverride | undefined => {
  if (!overrides) return undefined;

  const ruleOverride = overrides.rules?.[input.ruleKey];
  if (ruleOverride !== undefined) return ruleOverride;

  if (input.category !== undefined) {
    const categoryOverride = overrides.categories?.[input.category];
    if (categoryOverride !== undefined) return categoryOverride;
  }

  return collectTagOverride(input.tags, overrides.tags);
};
