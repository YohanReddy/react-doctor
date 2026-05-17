import { describe, expect, it } from "vite-plus/test";
import type { RuleSeverityControls } from "@react-doctor/types";
import { resolveRuleSeverityOverride } from "@react-doctor/core";

describe("resolveRuleSeverityOverride", () => {
  it("returns undefined when no overrides are configured", () => {
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/no-array-index-as-key", category: "Correctness" },
        undefined,
      ),
    ).toBeUndefined();
  });

  it("returns the per-rule override when one matches", () => {
    const overrides: RuleSeverityControls = {
      rules: { "react-doctor/no-array-index-as-key": "warn" },
    };
    expect(
      resolveRuleSeverityOverride(
        { ruleKey: "react-doctor/no-array-index-as-key", category: "Correctness" },
        overrides,
      ),
    ).toBe("warn");
  });

  it("prefers per-rule over per-category over per-tag", () => {
    const overrides: RuleSeverityControls = {
      rules: { "react-doctor/example-rule": "error" },
      categories: { Architecture: "warn" },
      tags: { design: "off" },
    };
    expect(
      resolveRuleSeverityOverride(
        {
          ruleKey: "react-doctor/example-rule",
          category: "Architecture",
          tags: ["design"],
        },
        overrides,
      ),
    ).toBe("error");
  });

  it("falls back to category when no rule key matches", () => {
    const overrides: RuleSeverityControls = {
      categories: { Server: "warn" },
      tags: { "server-action": "off" },
    };
    expect(
      resolveRuleSeverityOverride(
        {
          ruleKey: "react-doctor/server-auth-actions",
          category: "Server",
          tags: ["server-action"],
        },
        overrides,
      ),
    ).toBe("warn");
  });

  it("falls back to tags when neither rule nor category matches", () => {
    const overrides: RuleSeverityControls = {
      tags: { "react-native": "off" },
    };
    expect(
      resolveRuleSeverityOverride(
        {
          ruleKey: "react-doctor/rn-no-raw-text",
          category: "React Native",
          tags: ["react-native"],
        },
        overrides,
      ),
    ).toBe("off");
  });

  it("picks the most permissive override when multiple tags match (off > warn > error)", () => {
    const overrides: RuleSeverityControls = {
      tags: { design: "off", "test-noise": "warn" },
    };
    expect(
      resolveRuleSeverityOverride(
        {
          ruleKey: "react-doctor/design-no-redundant-size-axes",
          category: "Architecture",
          tags: ["design", "test-noise"],
        },
        overrides,
      ),
    ).toBe("off");
  });

  it("returns undefined when no override channel matches the rule", () => {
    const overrides: RuleSeverityControls = {
      rules: { "react-doctor/other-rule": "error" },
      categories: { Security: "warn" },
      tags: { design: "off" },
    };
    expect(
      resolveRuleSeverityOverride(
        {
          ruleKey: "react-doctor/no-array-index-as-key",
          category: "Correctness",
          tags: ["test-noise"],
        },
        overrides,
      ),
    ).toBeUndefined();
  });
});
