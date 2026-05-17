import type { BaseRuleContext } from "./rule-context.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

export interface HostRule extends Omit<Rule, "create"> {
  create: (context: BaseRuleContext) => RuleVisitors;
}

export interface RulePlugin {
  meta: { name: string };
  rules: Record<string, HostRule>;
}
