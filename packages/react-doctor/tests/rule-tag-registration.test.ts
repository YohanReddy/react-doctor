import { describe, expect, it } from "vite-plus/test";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";

const getRuleTags = (ruleId: string): ReadonlyArray<string> => {
  const rule = reactDoctorPlugin.rules[ruleId];
  if (!rule) throw new Error(`Unknown rule: ${ruleId}`);
  return rule.tags ?? [];
};

describe("rule tag registration", () => {
  it('tags every React Native bucket rule with "react-native"', () => {
    const reactNativeRuleIds = Object.entries(reactDoctorPlugin.rules)
      .filter(([, rule]) => rule.framework === "react-native")
      .map(([ruleId]) => ruleId);
    expect(reactNativeRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of reactNativeRuleIds) {
      expect(getRuleTags(ruleId)).toContain("react-native");
    }
  });

  it('tags every server bucket rule with "server-action"', () => {
    const serverRuleIds = Object.entries(reactDoctorPlugin.rules)
      .filter(([, rule]) => rule.category === "Server")
      .map(([ruleId]) => ruleId);
    expect(serverRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of serverRuleIds) {
      expect(getRuleTags(ruleId)).toContain("server-action");
    }
  });

  it('tags the four migration-hint rules with "migration-hint"', () => {
    const migrationHintRuleIds = [
      "no-react19-deprecated-apis",
      "no-react-dom-deprecated-apis",
      "no-legacy-class-lifecycles",
      "no-legacy-context-api",
    ];
    for (const ruleId of migrationHintRuleIds) {
      expect(getRuleTags(ruleId)).toContain("migration-hint");
    }
  });

  it("preserves rule-authored tags alongside bucket auto-tags (e.g. test-noise stays on react-native rules that opted in)", () => {
    // `rn-no-raw-text` is in the react-native bucket; its only auto-tag
    // is "react-native". `no-react19-deprecated-apis` is in architecture
    // and authors both "test-noise" and "migration-hint" — no auto-tag
    // overwrites those.
    expect(getRuleTags("rn-no-raw-text")).toEqual(["react-native"]);
    const migrationHintTags = getRuleTags("no-react19-deprecated-apis");
    expect(migrationHintTags).toContain("test-noise");
    expect(migrationHintTags).toContain("migration-hint");
  });
});
