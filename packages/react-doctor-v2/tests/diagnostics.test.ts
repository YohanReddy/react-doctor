import { describe, expect, it } from "vite-plus/test";
import { filterReactDoctorIssues } from "../src/sdk/index.js";
import type { ReactDoctorIssue } from "../src/sdk/index.js";

const createRawTextIssue = (line: number): ReactDoctorIssue => ({
  id: `react-doctor/rn-no-raw-text/${line}`,
  title: "Raw text",
  message: "Raw text outside a <Text> component",
  severity: "error",
  category: "oxlint",
  location: { filePath: "src/component.tsx", line },
  source: {
    checkId: "react-doctor/oxlint",
    pluginName: "react-doctor",
    ruleId: "rn-no-raw-text",
  },
});

describe("diagnostics", () => {
  it("suppresses configured React Native raw text components", () => {
    const issues = filterReactDoctorIssues(
      [createRawTextIssue(1)],
      { textComponents: ["Trans"] },
      "/repo",
      () => ["<Trans>Hello</Trans>"],
    );

    expect(issues).toEqual([]);
  });

  it("suppresses configured raw text wrappers only for string-only children", () => {
    const suppressedIssues = filterReactDoctorIssues(
      [createRawTextIssue(1)],
      { rawTextWrapperComponents: ["Button"] },
      "/repo",
      () => ["<Button>Cancel</Button>"],
    );
    const mixedIssues = filterReactDoctorIssues(
      [createRawTextIssue(1)],
      { rawTextWrapperComponents: ["Button"] },
      "/repo",
      () => ["<Button>Save <Icon /></Button>"],
    );

    expect(suppressedIssues).toEqual([]);
    expect(mixedIssues).toHaveLength(1);
  });
});
