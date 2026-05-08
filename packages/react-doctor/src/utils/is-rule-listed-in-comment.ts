// Returns true when a `react-doctor-disable*` comment's rule list
// covers the given rule id. A bare comment (no rule list) covers every
// rule. Otherwise the list is split on commas and whitespace and any
// exact-match token wins.
export const isRuleListedInComment = (ruleList: string | undefined, ruleId: string): boolean => {
  if (!ruleList?.trim()) return true;
  return ruleList.split(/[,\s]+/).some((token) => token.trim() === ruleId);
};
