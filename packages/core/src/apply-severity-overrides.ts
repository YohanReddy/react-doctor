import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { resolveRuleSeverityOverride } from "./resolve-rule-severity-override.js";

const getRuleTagsForDiagnostic = (diagnostic: Diagnostic): ReadonlyArray<string> | undefined => {
  if (diagnostic.plugin !== "react-doctor") return undefined;
  return reactDoctorPlugin.rules[diagnostic.rule]?.tags;
};

/**
 * Applies the user's `severityOverrides` to a post-lint diagnostic list:
 *
 * - `"off"` removes the diagnostic entirely. For react-doctor rules
 *   this is normally already handled at lint registration time, but
 *   this post-filter also covers external plugins (`react/*`,
 *   `jsx-a11y/*`, custom adopted configs) whose severities we don't
 *   control at registration.
 * - `"warn"` / `"error"` re-stamps `diagnostic.severity` so downstream
 *   consumers — `--fail-on`, the score input, the CLI summary —
 *   see the user-chosen severity rather than the rule's built-in one.
 *
 * Returns the input array unchanged when no overrides are configured,
 * so the common path stays allocation-free.
 */
export const applySeverityOverrides = (
  diagnostics: Diagnostic[],
  config: ReactDoctorConfig | null,
): Diagnostic[] => {
  const overrides = config?.severityOverrides;
  if (!overrides) return diagnostics;

  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const override = resolveRuleSeverityOverride(
      {
        ruleKey: `${diagnostic.plugin}/${diagnostic.rule}`,
        category: diagnostic.category,
        tags: getRuleTagsForDiagnostic(diagnostic),
      },
      overrides,
    );
    if (override === "off") continue;
    if (override === "error" || override === "warn") {
      const targetSeverity = override === "error" ? "error" : "warning";
      if (diagnostic.severity !== targetSeverity) {
        result.push({ ...diagnostic, severity: targetSeverity });
        continue;
      }
    }
    result.push(diagnostic);
  }
  return result;
};
