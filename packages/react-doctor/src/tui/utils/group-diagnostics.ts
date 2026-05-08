import type { Diagnostic } from "../../types.js";
import type { GroupedRule } from "../types.js";

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = {
  error: 0,
  warning: 1,
};

export const groupDiagnosticsByRule = (diagnostics: Diagnostic[]): GroupedRule[] => {
  const groupsByRuleKey = new Map<string, GroupedRule>();
  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    const existing = groupsByRuleKey.get(ruleKey);
    if (existing) {
      existing.diagnostics.push(diagnostic);
      continue;
    }
    groupsByRuleKey.set(ruleKey, {
      ruleKey,
      plugin: diagnostic.plugin,
      rule: diagnostic.rule,
      severity: diagnostic.severity,
      category: diagnostic.category,
      message: diagnostic.message,
      help: diagnostic.help,
      diagnostics: [diagnostic],
    });
  }
  return [...groupsByRuleKey.values()].sort((firstRule, secondRule) => {
    const severityDelta = SEVERITY_ORDER[firstRule.severity] - SEVERITY_ORDER[secondRule.severity];
    if (severityDelta !== 0) return severityDelta;
    return secondRule.diagnostics.length - firstRule.diagnostics.length;
  });
};
