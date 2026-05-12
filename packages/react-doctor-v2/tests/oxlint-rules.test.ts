import { describe, expect, it } from "vite-plus/test";
import {
  BUILTIN_A11Y_OXLINT_RULES,
  BUILTIN_REACT_OXLINT_RULES,
  REACT_DOCTOR_OXLINT_RULE_ID_PREFIX,
  REACT_DOCTOR_CUSTOM_OXLINT_RULES,
  createReactDoctorOxlintConfig,
  reactPeerRangeMinMajor,
  reactDoctorOxlintPlugin,
  reactDoctorOxlintRuleMetadata,
} from "../src/sdk/index.js";
import { findSideEffect } from "../src/core/rules/lint/utils/find-side-effect.js";
import { isInsideWebPlatformBranch } from "../src/core/rules/lint/react-native/utils/index.js";
import type { EsTreeNode } from "../src/core/rules/lint/utils/index.js";

const toExpectedSeverity = (ruleName: string): "error" | "warning" | "info" => {
  const oxlintSeverity = REACT_DOCTOR_CUSTOM_OXLINT_RULES[`react-doctor/${ruleName}`] ?? "warn";
  if (oxlintSeverity === "error") return "error";
  if (oxlintSeverity === "off") return "info";
  return "warning";
};

describe("oxlint rules", () => {
  it("does not treat outbound response header mutations as GET side effects", () => {
    const node: EsTreeNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "response" },
          property: { type: "Identifier", name: "headers" },
        },
        property: { type: "Identifier", name: "set" },
      },
    };

    expect(findSideEffect(node)).toBeNull();
  });

  it("detects React Native web-only platform branches", () => {
    const elementNode: EsTreeNode = { type: "JSXElement" };
    const expressionNode: EsTreeNode = {
      type: "ConditionalExpression",
      test: {
        type: "BinaryExpression",
        operator: "===",
        left: {
          type: "MemberExpression",
          object: { type: "Identifier", name: "Platform" },
          property: { type: "Identifier", name: "OS" },
        },
        right: { type: "Literal", value: "web" },
      },
      consequent: elementNode,
      alternate: { type: "Literal", value: null },
    };
    elementNode.parent = expressionNode;

    expect(isInsideWebPlatformBranch(elementNode)).toBe(true);
  });

  it("does not flag lazy iterator helper chains as duplicate array passes", () => {
    const reports: EsTreeNode[] = [];
    const visitors = reactDoctorOxlintPlugin.rules["js-combine-iterations"].create({
      report: ({ node }) => reports.push(node),
    });
    const valuesCall: EsTreeNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "numbers" },
        property: { type: "Identifier", name: "values" },
      },
    };
    const filterCall: EsTreeNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: valuesCall,
        property: { type: "Identifier", name: "filter" },
      },
      arguments: [],
    };
    const mapCall: EsTreeNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: filterCall,
        property: { type: "Identifier", name: "map" },
      },
      arguments: [],
    };

    visitors.CallExpression?.(mapCall);

    expect(reports).toEqual([]);
  });

  it("exports metadata for every custom oxlint plugin rule", () => {
    const pluginRuleNames = Object.keys(reactDoctorOxlintPlugin.rules).sort();

    expect(reactDoctorOxlintRuleMetadata.map((rule) => rule.oxlintRuleName)).toEqual(
      pluginRuleNames,
    );
    expect(reactDoctorOxlintRuleMetadata.every((rule) => Boolean(rule.recommendation))).toBe(true);
    expect(
      reactDoctorOxlintRuleMetadata.every(
        (rule) =>
          rule.examples?.every(
            (example) => example.before.trim().length > 0 && example.after.trim().length > 0,
          ) ?? true,
      ),
    ).toBe(true);
    expect(reactDoctorOxlintRuleMetadata).toEqual(
      pluginRuleNames.map((ruleName) => ({
        id: `${REACT_DOCTOR_OXLINT_RULE_ID_PREFIX}${ruleName}`,
        name: expect.any(String),
        description: `Runs the react-doctor/${ruleName} custom oxlint rule.`,
        recommendation: expect.any(String),
        examples: expect.any(Array),
        category: "oxlint",
        severity: toExpectedSeverity(ruleName),
        defaultEnabled: false,
        tags: ["oxlint", "custom", "react-doctor"],
        oxlintRuleName: ruleName,
        oxlintRuleKey: `react-doctor/${ruleName}`,
      })),
    );
  });

  it("builds the legacy curated oxlint config with built-in plugin rules", () => {
    const config = createReactDoctorOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      framework: "nextjs",
      hasTanStackQuery: true,
    });

    expect(config.plugins).toEqual(["react", "jsx-a11y"]);
    expect(config.jsPlugins).toContain("/tmp/react-doctor-plugin.js");
    expect(config.jsPlugins).not.toContainEqual(expect.objectContaining({ name: "effect" }));
    expect(config.categories).toEqual({
      correctness: "off",
      nursery: "off",
      pedantic: "off",
      perf: "off",
      restriction: "off",
      style: "off",
      suspicious: "off",
    });
    expect(config.rules).toMatchObject({
      ...BUILTIN_REACT_OXLINT_RULES,
      ...BUILTIN_A11Y_OXLINT_RULES,
      "react/exhaustive-deps": "warn",
      "react-doctor/nextjs-no-img-element": "warn",
      "react-doctor/effect-no-derived-state": "warn",
      "react-doctor/effect-no-initialize-state": "warn",
      "react-doctor/query-no-unstable-query-key": "error",
    });
    expect(config.rules["react-doctor/design-no-three-period-ellipsis"]).toBeUndefined();
  });

  it("supports custom-rule-only oxlint configs", () => {
    const config = createReactDoctorOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      customRulesOnly: true,
    });

    expect(config.plugins).toEqual([]);
    expect(config.rules["react/rules-of-hooks"]).toBeUndefined();
    expect(config.rules["jsx-a11y/alt-text"]).toBeUndefined();
    expect(config.rules["react-doctor/no-fetch-in-effect"]).toBe("warn");
  });

  it("gates framework, version, and tag-scoped rules", () => {
    const react18Config = createReactDoctorOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: {
        framework: "react",
        reactMajorVersion: 18,
        hasTanStackQuery: true,
      },
      ignoredTags: new Set(["design"]),
    });

    expect(react18Config.rules["react-doctor/no-react19-deprecated-apis"]).toBeUndefined();
    expect(react18Config.rules["react-doctor/prefer-use-effect-event"]).toBeUndefined();
    expect(react18Config.rules["react-doctor/query-no-unstable-query-key"]).toBe("error");
    expect(react18Config.rules["react-doctor/rn-no-raw-text"]).toBeUndefined();
    expect(react18Config.rules["react-doctor/design-no-bold-heading"]).toBeUndefined();
    expect(react18Config.rules["react-doctor/design-no-em-dash-in-jsx-text"]).toBeUndefined();
  });

  it("uses React peer range floors for library-oriented version gates", () => {
    expect(reactPeerRangeMinMajor("^17 || ^18 || ^19")).toBe(17);

    const libraryConfig = createReactDoctorOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: {
        framework: "react",
        reactMajorVersion: 19,
        reactPeerDependencyRange: "^17 || ^18 || ^19",
      },
    });

    expect(libraryConfig.rules["react-doctor/no-react19-deprecated-apis"]).toBeUndefined();
    expect(libraryConfig.rules["react-doctor/no-default-props"]).toBeUndefined();
  });
});
