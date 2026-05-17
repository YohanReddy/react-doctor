import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { applySeverityOverrides } from "@react-doctor/core";

const designDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "design-no-redundant-size-axes",
  severity: "warning",
  message: "w-5 h-5 → size-5",
  help: "",
  line: 12,
  column: 4,
  category: "Architecture",
};

const rnDiagnostic: Diagnostic = {
  filePath: "src/Screen.tsx",
  plugin: "react-doctor",
  rule: "rn-no-raw-text",
  severity: "error",
  message: "raw text outside <Text>",
  help: "",
  line: 4,
  column: 2,
  category: "React Native",
};

const externalPluginDiagnostic: Diagnostic = {
  filePath: "src/Form.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "Avoid dangerouslySetInnerHTML",
  help: "",
  line: 5,
  column: 2,
  category: "Security",
};

describe("applySeverityOverrides", () => {
  it("returns input unchanged when no overrides are configured", () => {
    const diagnostics = [designDiagnostic, rnDiagnostic];
    expect(applySeverityOverrides(diagnostics, null)).toBe(diagnostics);
    expect(applySeverityOverrides(diagnostics, {})).toBe(diagnostics);
  });

  it('drops diagnostics whose rule tag is overridden to "off"', () => {
    const config: ReactDoctorConfig = {
      severityOverrides: { tags: { design: "off" } },
    };
    const filtered = applySeverityOverrides([designDiagnostic, rnDiagnostic], config);
    expect(filtered).toEqual([rnDiagnostic]);
  });

  it('drops diagnostics whose category is overridden to "off"', () => {
    const config: ReactDoctorConfig = {
      severityOverrides: { categories: { "React Native": "off" } },
    };
    const filtered = applySeverityOverrides([designDiagnostic, rnDiagnostic], config);
    expect(filtered).toEqual([designDiagnostic]);
  });

  it("re-stamps severity for matching rules", () => {
    const config: ReactDoctorConfig = {
      severityOverrides: { rules: { "react-doctor/rn-no-raw-text": "warn" } },
    };
    const filtered = applySeverityOverrides([rnDiagnostic], config);
    expect(filtered).toEqual([{ ...rnDiagnostic, severity: "warning" }]);
  });

  it("works on external-plugin diagnostics via rule key and category (no rule tags available)", () => {
    const config: ReactDoctorConfig = {
      severityOverrides: { rules: { "react/no-danger": "off" } },
    };
    expect(applySeverityOverrides([externalPluginDiagnostic], config)).toEqual([]);
  });

  it("promotes warning to error when override demands it", () => {
    const config: ReactDoctorConfig = {
      severityOverrides: {
        categories: { Security: "error" },
      },
    };
    const filtered = applySeverityOverrides([externalPluginDiagnostic], config);
    expect(filtered).toEqual([{ ...externalPluginDiagnostic, severity: "error" }]);
  });
});
