import { describe, expect, it } from "vite-plus/test";
import {
  BUILTIN_A11Y_OXLINT_RULES,
  BUILTIN_REACT_OXLINT_RULES,
  CURATED_OXLINT_RULES,
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

  it("flags Hono-style GET adapter exports on mutating route segments", () => {
    const reports: { node: EsTreeNode; message: string }[] = [];
    const visitors = reactDoctorOxlintPlugin.rules["nextjs-no-side-effect-in-get-handler"].create({
      report: (descriptor) => reports.push(descriptor),
      getFilename: () => "app/api/logout/route.ts",
    });

    const getExport: EsTreeNode = {
      type: "ExportNamedDeclaration",
      declaration: {
        type: "VariableDeclaration",
        declarations: [
          {
            type: "VariableDeclarator",
            id: { type: "Identifier", name: "GET" },
            init: {
              type: "CallExpression",
              callee: { type: "Identifier", name: "handle" },
              arguments: [{ type: "Identifier", name: "app" }],
            },
          },
        ],
      },
    };
    const program: EsTreeNode = { type: "Program", body: [getExport] };

    visitors.Program?.(program);
    visitors.ExportNamedDeclaration?.(getExport);

    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain('"/logout"');
  });

  it("detects side effects through Hono-style chained router adapters", () => {
    const reports: { node: EsTreeNode; message: string }[] = [];
    const visitors = reactDoctorOxlintPlugin.rules["nextjs-no-side-effect-in-get-handler"].create({
      report: (descriptor) => reports.push(descriptor),
      getFilename: () => "app/api/repositories/route.ts",
    });

    const handlerBody: EsTreeNode = {
      type: "BlockStatement",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "AwaitExpression",
            argument: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                object: { type: "Identifier", name: "db" },
                property: { type: "Identifier", name: "create" },
              },
              arguments: [],
            },
          },
        },
      ],
    };
    const routerInit: EsTreeNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: {
          type: "NewExpression",
          callee: { type: "Identifier", name: "Hono" },
          arguments: [],
        },
        property: { type: "Identifier", name: "get" },
      },
      arguments: [
        { type: "Literal", value: "/" },
        {
          type: "ArrowFunctionExpression",
          params: [{ type: "Identifier", name: "ctx" }],
          body: handlerBody,
        },
      ],
    };
    const appDeclaration: EsTreeNode = {
      type: "VariableDeclaration",
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: "app" },
          init: routerInit,
        },
      ],
    };
    const getExport: EsTreeNode = {
      type: "ExportNamedDeclaration",
      declaration: {
        type: "VariableDeclaration",
        declarations: [
          {
            type: "VariableDeclarator",
            id: { type: "Identifier", name: "GET" },
            init: {
              type: "CallExpression",
              callee: { type: "Identifier", name: "handle" },
              arguments: [{ type: "Identifier", name: "app" }],
            },
          },
        ],
      },
    };
    const program: EsTreeNode = { type: "Program", body: [appDeclaration, getExport] };

    visitors.Program?.(program);
    visitors.ExportNamedDeclaration?.(getExport);

    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain("db.create()");
  });

  it("does not flag chained `.get(key)` calls that are not route definitions", () => {
    const reports: { node: EsTreeNode; message: string }[] = [];
    const visitors = reactDoctorOxlintPlugin.rules["nextjs-no-side-effect-in-get-handler"].create({
      report: (descriptor) => reports.push(descriptor),
      getFilename: () => "app/api/things/route.ts",
    });

    const mapBinding: EsTreeNode = {
      type: "VariableDeclaration",
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: "lookupHandler" },
          init: {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "registry" },
              property: { type: "Identifier", name: "get" },
            },
            arguments: [{ type: "Literal", value: "things" }],
          },
        },
      ],
    };
    const getExport: EsTreeNode = {
      type: "ExportNamedDeclaration",
      declaration: {
        type: "VariableDeclaration",
        declarations: [
          {
            type: "VariableDeclarator",
            id: { type: "Identifier", name: "GET" },
            init: {
              type: "CallExpression",
              callee: { type: "Identifier", name: "handle" },
              arguments: [{ type: "Identifier", name: "lookupHandler" }],
            },
          },
        ],
      },
    };
    const program: EsTreeNode = { type: "Program", body: [mapBinding, getExport] };

    visitors.Program?.(program);
    visitors.ExportNamedDeclaration?.(getExport);

    expect(reports).toEqual([]);
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
    expect(config.rules["react-hooks-js/todo"]).toBeUndefined();
    expect(config.rules["react-doctor/design-no-three-period-ellipsis"]).toBeUndefined();
  });

  it("keeps React Compiler rules out of the generic curated export", () => {
    expect(CURATED_OXLINT_RULES["react-hooks-js/todo"]).toBeUndefined();
    expect(CURATED_OXLINT_RULES["react/rules-of-hooks"]).toBe("error");
    expect(CURATED_OXLINT_RULES["react-doctor/no-fetch-in-effect"]).toBe("warn");
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

  it("adds React Compiler frontend rules when the compiler is detected", () => {
    const config = createReactDoctorOxlintConfig({
      pluginPath: "/tmp/react-doctor-plugin.js",
      project: {
        framework: "react",
        hasReactCompiler: true,
      },
    });

    expect(config.jsPlugins).toContainEqual(
      expect.objectContaining({
        name: "react-hooks-js",
      }),
    );
    expect(config.rules).toMatchObject({
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "react-hooks-js/component-hook-factories": "error",
      "react-hooks-js/error-boundaries": "error",
      "react-hooks-js/globals": "error",
      "react-hooks-js/hooks": "error",
      "react-hooks-js/immutability": "error",
      "react-hooks-js/incompatible-library": "error",
      "react-hooks-js/preserve-manual-memoization": "error",
      "react-hooks-js/purity": "error",
      "react-hooks-js/refs": "error",
      "react-hooks-js/set-state-in-effect": "error",
      "react-hooks-js/set-state-in-render": "error",
      "react-hooks-js/static-components": "error",
      "react-hooks-js/todo": "error",
      "react-hooks-js/unsupported-syntax": "error",
      "react-hooks-js/use-memo": "error",
      "react-hooks-js/void-use-memo": "error",
    });
  });
});
