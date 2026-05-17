import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic } from "@react-doctor/types";

export interface DiagnosticRuleIdentity {
  ruleKey: string;
  category: string;
  tags: ReadonlyArray<string>;
}

/**
 * Projects a diagnostic onto the three axes every rule-targeted control
 * (`surfaces`, `severity`, `ignore.tags`) reasons about:
 *
 * - `ruleKey` — the fully-qualified `"<plugin>/<rule>"` form users
 *   put in config files.
 * - `category` — the diagnostic's category label (`"Server"`,
 *   `"React Native"`, `"Architecture"`, …).
 * - `tags` — behavioral tags from the rule registry (e.g. `"design"`,
 *   `"test-noise"`, `"react-native"`, `"server-action"`,
 *   `"migration-hint"`). Empty for diagnostics emitted by plugins
 *   other than `react-doctor` because we don't own their metadata.
 */
export const getDiagnosticRuleIdentity = (diagnostic: Diagnostic): DiagnosticRuleIdentity => ({
  ruleKey: `${diagnostic.plugin}/${diagnostic.rule}`,
  category: diagnostic.category,
  tags:
    diagnostic.plugin === "react-doctor"
      ? (reactDoctorPlugin.rules[diagnostic.rule]?.tags ?? [])
      : [],
});
