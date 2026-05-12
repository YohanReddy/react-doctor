import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  DEAD_CODE_RULE_ID,
  DEPENDENCIES_RULE_ID,
  REACT_ARCHITECTURE_RULE_ID,
  inspectReactProject,
} from "../src/sdk/index.js";

const PROJECT_STRUCTURE_RULE_ID = "react-doctor/react-project-structure";
const FULL_PORT_FIXTURE_PATH = path.join(import.meta.dirname, "fixtures/codebase/full-port");

const createFixtureProject = async (files: Record<string, string>): Promise<string> => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "react-doctor-codebase-"));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, sourceText]) => {
      const filePath = path.join(rootDirectory, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, sourceText);
    }),
  );
  return rootDirectory;
};

describe("codebase rules", () => {
  it("reports unused files and exports from the native dead-code graph", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.tsx": "import { App } from './app';\nconsole.log(App);\n",
      "src/app.tsx": [
        "export const App = () => null;",
        "export const Unused = 1;",
        "export type UnusedType = { value: string };",
      ].join("\n"),
      "src/dead.ts": "export const Dead = 1;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.checks).toHaveLength(1);
    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "unused-export",
      "unused-file",
      "unused-type-export",
    ]);
    expect(result.issues.map((issue) => issue.location?.filePath).sort()).toEqual([
      "src/app.tsx",
      "src/app.tsx",
      "src/dead.ts",
    ]);
  });

  it("treats runner files as support entrypoints", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": "console.log('main');\n",
      "src/model.eval.ts": "export const evalScenario = () => 'ok';\n",
      "evalite.config.ts": "export default { root: 'src' };\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.location?.filePath).sort()).toEqual([]);
  });

  it("respects gitignore patterns during source discovery", async () => {
    const rootDirectory = await createFixtureProject({
      ".gitignore": ["generated/", "!generated/keep.ts"].join("\n"),
      "src/main.ts": "console.log('main');\n",
      "generated/ignored.ts": "export const Ignored = 1;\n",
      "generated/keep.ts": "export const Keep = 1;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/generated/keep.ts`,
    ]);
  });

  it("keeps type-only imported files reachable for dead-code analysis", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts":
        "import type { UsedType } from './types';\nconst value: UsedType = { value: 'ok' };\nconsole.log(value);\n",
      "src/types.ts": [
        "export interface UsedType { value: string }",
        "export interface UnusedType { value: number }",
      ].join("\n"),
      "src/dead.ts": "export interface DeadType { value: boolean }\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "unused-file",
      "unused-type-export",
    ]);
    expect(result.issues.map((issue) => issue.location?.filePath).sort()).toEqual([
      "src/dead.ts",
      "src/types.ts",
    ]);
  });

  it("supports expected-unused export markers and stale marker reporting", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts":
        "import { staleExpectedUnused } from './markers';\nconsole.log(staleExpectedUnused);\n",
      "src/markers.ts": [
        "/** @expected-unused */",
        "export const intentionallyUnused = 1;",
        "/** @expected-unused */",
        "export const staleExpectedUnused = 2;",
        "export const regularUnused = 3;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/stale-expected-unused/src/markers.ts/staleExpectedUnused`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/markers.ts/regularUnused`,
    ]);
  });

  it("does not mark unused imported bindings as used exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.tsx": [
        "import { UsedComponent, unusedValue } from './lib';",
        "import type { UsedType, UnusedType } from './types';",
        "const value: UsedType = { value: 'ok' };",
        "console.log(value);",
        "const App = () => <UsedComponent />;",
        "console.log(App);",
      ].join("\n"),
      "src/lib.tsx": [
        "export const UsedComponent = () => null;",
        "export const unusedValue = 1;",
      ].join("\n"),
      "src/types.ts": [
        "export interface UsedType { value: string }",
        "export interface UnusedType { value: number }",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/lib.tsx/unusedValue`,
      `${DEAD_CODE_RULE_ID}/unused-type-export/src/types.ts/UnusedType`,
    ]);
  });

  it("reports unused exported enum and static class members", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { FeatureFlags, Status } from './members';",
        "console.log(Status.Active, FeatureFlags.enabled);",
      ].join("\n"),
      "src/members.ts": [
        "export enum Status {",
        "  Active = 'active',",
        "  Inactive = 'inactive',",
        "}",
        "export class FeatureFlags {",
        "  static enabled = true;",
        "  static disabled = false;",
        "  instanceOnly() { return true; }",
        "}",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-class-member/src/members.ts/FeatureFlags.disabled`,
      `${DEAD_CODE_RULE_ID}/unused-enum-member/src/members.ts/Status.Inactive`,
    ]);
  });

  it("propagates namespace object alias member usage to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": ["import { API } from './api';", "console.log(API.service.usedService);"].join(
        "\n",
      ),
      "src/api.ts": "import * as service from './service';\nexport const API = { service };\n",
      "src/service.ts": ["export const usedService = 1;", "export const unusedService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates namespace object alias member usage to exported members", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { API } from './api';",
        "console.log(API.service.Feature.enabled);",
      ].join("\n"),
      "src/api.ts": "import * as service from './service';\nexport const API = { service };\n",
      "src/service.ts": [
        "export class Feature {",
        "  static enabled = true;",
        "  static disabled = false;",
        "}",
        "export const unusedService = 1;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-class-member/src/service.ts/Feature.disabled`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates local namespace import aliases to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as service from './service';",
        "const serviceAlias = service;",
        "console.log(serviceAlias.usedService);",
      ].join("\n"),
      "src/service.ts": ["export const usedService = 1;", "export const unusedService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates conditional namespace import aliases to all possible sources", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as browserService from './browser-service';",
        "import * as serverService from './server-service';",
        "const service = Math.random() > 0.5 ? browserService : serverService;",
        "console.log(service.usedService);",
      ].join("\n"),
      "src/browser-service.ts": [
        "export const usedService = 1;",
        "export const unusedBrowserService = 2;",
      ].join("\n"),
      "src/server-service.ts": [
        "export const usedService = 1;",
        "export const unusedServerService = 2;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/duplicate-export/usedService`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/browser-service.ts/unusedBrowserService`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/server-service.ts/unusedServerService`,
    ]);
  });

  it("propagates namespace object spread aliases to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as service from './service';",
        "const api = { ...service };",
        "console.log(api.usedService);",
      ].join("\n"),
      "src/service.ts": ["export const usedService = 1;", "export const unusedService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates destructured namespace imports to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as service from './service';",
        "const { usedService } = service;",
        "console.log(usedService);",
      ].join("\n"),
      "src/service.ts": ["export const usedService = 1;", "export const unusedService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates local namespace object containers to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as service from './service';",
        "const api = { service };",
        "console.log(api.service.usedService);",
      ].join("\n"),
      "src/service.ts": ["export const usedService = 1;", "export const unusedService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates local namespace object container member usage to exported members", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import * as service from './service';",
        "const api = { service };",
        "console.log(api.service.Feature.enabled);",
      ].join("\n"),
      "src/service.ts": [
        "export class Feature {",
        "  static enabled = true;",
        "  static disabled = false;",
        "}",
        "export const unusedService = 1;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-class-member/src/service.ts/Feature.disabled`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("keeps namespace object alias whole-object usage from reporting unused exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { API } from './api';",
        "import * as ApiModule from './api';",
        "console.log(Object.values(API), Object.values(API.service), ApiModule.API.service);",
      ].join("\n"),
      "src/api.ts": "import * as service from './service';\nexport const API = { service };\n",
      "src/service.ts": ["export const firstService = 1;", "export const secondService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/namespace-only-export/src/service.ts/firstService`,
      `${DEAD_CODE_RULE_ID}/namespace-only-export/src/service.ts/secondService`,
    ]);
  });

  it("propagates namespace re-export member usage to source exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { Service } from './barrel';",
        "import * as Barrel from './barrel';",
        "import { RenamedService } from './outer';",
        "console.log(Service.usedService, Barrel.Service.otherUsedService, RenamedService.renamedUsedService);",
      ].join("\n"),
      "src/barrel.ts": "export * as Service from './service';\n",
      "src/outer.ts": "export { Service as RenamedService } from './barrel';\n",
      "src/service.ts": [
        "export const usedService = 1;",
        "export const otherUsedService = 2;",
        "export const renamedUsedService = 3;",
        "export const unusedService = 3;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("propagates namespace re-export member usage to exported members", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { Service } from './barrel';",
        "console.log(Service.Feature.enabled);",
      ].join("\n"),
      "src/barrel.ts": "export * as Service from './service';\n",
      "src/service.ts": [
        "export class Feature {",
        "  static enabled = true;",
        "  static disabled = false;",
        "}",
        "export const unusedService = 1;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-class-member/src/service.ts/Feature.disabled`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/service.ts/unusedService`,
    ]);
  });

  it("keeps namespace re-export whole-object usage from reporting unused exports", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import { Service } from './barrel';",
        "import * as Barrel from './barrel';",
        "console.log(Object.values(Service), Barrel.Service);",
      ].join("\n"),
      "src/barrel.ts": "export * as Service from './service';\n",
      "src/service.ts": ["export const firstService = 1;", "export const secondService = 2;"].join(
        "\n",
      ),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/namespace-only-export/src/service.ts/firstService`,
      `${DEAD_CODE_RULE_ID}/namespace-only-export/src/service.ts/secondService`,
    ]);
  });

  it("tracks triple-slash, JSDoc, and worker URL imports", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        devDependencies: {
          "comment-types": "latest",
          "unused-dev": "latest",
        },
      }),
      "src/main.ts": [
        '/// <reference path="./referenced.ts" />',
        '/** @typedef {import("./models").User} User */',
        '/** @import { ExternalType } from "comment-types" */',
        "new Worker(new URL('./worker.ts', import.meta.url));",
      ].join("\n"),
      "src/referenced.ts": "console.log('referenced');\n",
      "src/models.ts": "console.log('models');\n",
      "src/worker.ts": "console.log('worker');\n",
      "src/dead.ts": "console.log('dead');\n",
      "node_modules/comment-types/package.json": JSON.stringify({
        name: "comment-types",
        main: "index.js",
      }),
      "node_modules/comment-types/index.js": "export const value = 'type';\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/src/dead.ts`,
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./unused-dev`,
    ]);
  });

  it("tracks CommonJS require bindings without marking every export used", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.js": [
        "const { used } = require('./lib');",
        "const namespace = require('./namespace');",
        "const member = require('./member').member;",
        "console.log(used, namespace.keep, member);",
      ].join("\n"),
      "src/lib.js": "exports.used = 1;\nexports.unused = 2;\n",
      "src/namespace.js": "exports.keep = 1;\nexports.drop = 2;\n",
      "src/member.js": "exports.member = 1;\nexports.extra = 2;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId)).toEqual([
      "unused-export",
      "unused-export",
      "unused-export",
    ]);
    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/lib.js/unused`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/member.js/extra`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/namespace.js/drop`,
    ]);
  });

  it("propagates re-export references without marking every star export used", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": "import { used } from './barrel';\nconsole.log(used);\n",
      "src/barrel.ts": "export * from './lib';\n",
      "src/lib.ts": "export const used = 1;\nexport const unused = 2;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/lib.ts/unused`,
    ]);
  });

  it("treats package entry re-exports as public API", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        main: "./src/index.ts",
      }),
      "src/index.ts":
        "export * from './public-api';\nexport { sourceNamedApi as namedApi } from './named-api';\n",
      "src/public-api.ts": "export const starApi = 1;\nexport const extraStarApi = 2;\n",
      "src/named-api.ts": "export const sourceNamedApi = 3;\nexport const privateNamedApi = 4;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/named-api.ts/privateNamedApi`,
    ]);
  });

  it("keeps side-effect and dynamic imports from marking every export used", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": [
        "import './setup';",
        "const dynamicModule = await import('./lazy');",
        "const { usedNamed } = await import('./lazy');",
        "const usedMember = (await import('./lazy')).usedMember;",
        "console.log(dynamicModule.usedNamespace, usedNamed, usedMember);",
      ].join("\n"),
      "src/setup.ts": "console.log('setup');\nexport const unusedSetupExport = 1;\n",
      "src/lazy.ts": [
        "export const usedNamespace = 1;",
        "export const usedNamed = 2;",
        "export const usedMember = 3;",
        "export const unusedDynamic = 4;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/lazy.ts/unusedDynamic`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/setup.ts/unusedSetupExport`,
    ]);
  });

  it("expands Vite glob and Webpack context imports into reachable files", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        dependencies: {
          vite: "latest",
        },
      }),
      "src/main.ts": [
        "const routeModules = import.meta.glob('./routes/*.ts');",
        "const widgetContext = require.context('./widgets', true, /\\.ts$/);",
        "console.log(routeModules, widgetContext);",
      ].join("\n"),
      "src/routes/home.ts": "console.log('home');\n",
      "src/routes/nested/details.ts": "console.log('details');\n",
      "src/widgets/card.ts": "console.log('card');\n",
      "src/widgets/nested/panel.ts": "console.log('panel');\n",
      "src/unused.ts": "console.log('unused');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/src/routes/nested/details.ts`,
      `${DEAD_CODE_RULE_ID}/unused-file/src/unused.ts`,
    ]);
  });

  it("expands template dynamic imports into reachable files", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": ["const locale = 'en';", "await import(`./locales/${locale}.ts`);"].join("\n"),
      "src/locales/en.ts": "console.log('en');\n",
      "src/locales/fr.ts": "console.log('fr');\n",
      "src/locales/nested/en.ts": "console.log('nested');\n",
      "src/unused.ts": "console.log('unused');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/src/locales/nested/en.ts`,
      `${DEAD_CODE_RULE_ID}/unused-file/src/unused.ts`,
    ]);
  });

  it("normalizes bundler query suffixes and loader prefixes", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        devDependencies: {
          "raw-loader": "latest",
          "unused-loader": "latest",
        },
      }),
      "src/main.ts": [
        "import './setup.ts?worker';",
        "import loaded from 'raw-loader!./loaded.ts?raw';",
        "console.log(loaded);",
      ].join("\n"),
      "src/setup.ts": "console.log('setup');\nexport const unusedSetup = 1;\n",
      "src/loaded.ts": "export default 'loaded';\nexport const unusedLoaded = 1;\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/loaded.ts/unusedLoaded`,
      `${DEAD_CODE_RULE_ID}/unused-export/src/setup.ts/unusedSetup`,
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./unused-loader`,
    ]);
  });

  it("treats local and package style asset imports as assets", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        dependencies: {
          "@fontsource/inter": "latest",
        },
        devDependencies: {
          "unused-style-tool": "latest",
        },
      }),
      "src/main.ts": [
        "import './global.css';",
        "import styles from './button.module.scss';",
        "import logo from './logo.svg';",
        "import '@fontsource/inter/index.css';",
        "console.log(styles, logo);",
      ].join("\n"),
      "src/dead.ts": "console.log('dead');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/src/dead.ts`,
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./unused-style-tool`,
    ]);
  });

  it("reports React architecture graph issues", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.tsx": [
        "import './client';",
        "import './consumer-a';",
        "import './consumer-b';",
        "import './consumer-c';",
        "import './cycle-a';",
      ].join("\n"),
      "src/client.tsx": "'use client';\nimport { action } from './server';\nconsole.log(action);\n",
      "src/server.ts": "'use server';\nexport const action = () => null;\n",
      "src/cycle-a.ts": "import { cycleB } from './cycle-b';\nexport const cycleA = cycleB;\n",
      "src/cycle-b.ts": "import { cycleA } from './cycle-a';\nexport const cycleB = cycleA;\n",
      "src/barrel.ts": [
        "export const one = 1;",
        "export const two = 2;",
        "export const three = 3;",
        "export const four = 4;",
        "export const five = 5;",
      ].join("\n"),
      "src/consumer-a.ts": "import { one } from './barrel';\nconsole.log(one);\n",
      "src/consumer-b.ts": "import { two } from './barrel';\nconsole.log(two);\n",
      "src/consumer-c.ts": "import { three } from './barrel';\nconsole.log(three);\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [REACT_ARCHITECTURE_RULE_ID],
      },
    });

    expect(result.checks).toHaveLength(1);
    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "barrel-hotspot",
      "circular-import",
      "client-server-boundary",
    ]);
  });

  it("reports runtime circular imports once and ignores type-only cycles", async () => {
    const rootDirectory = await createFixtureProject({
      "src/main.ts": "import './runtime-a';\nimport './type-a';\n",
      "src/runtime-a.ts":
        "import { runtimeB } from './runtime-b';\nexport const runtimeA = runtimeB;\n",
      "src/runtime-b.ts":
        "import { runtimeC } from './runtime-c';\nexport const runtimeB = runtimeC;\n",
      "src/runtime-c.ts":
        "import { runtimeA } from './runtime-a';\nexport const runtimeC = runtimeA;\n",
      "src/type-a.ts":
        "import type { TypeB } from './type-b';\nexport interface TypeA { value: TypeB }\n",
      "src/type-b.ts":
        "import type { TypeA } from './type-a';\nexport interface TypeB { value: TypeA }\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [REACT_ARCHITECTURE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId)).toEqual(["circular-import"]);
    expect(result.issues[0]?.id).toContain("runtime-a.ts");
    expect(result.issues[0]?.id).toContain("runtime-b.ts");
    expect(result.issues[0]?.id).toContain("runtime-c.ts");
    expect(result.issues[0]?.id).not.toContain("type-a.ts");
  });

  it("honors framework plugin exports and tooling dependencies", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        dependencies: {
          next: "latest",
          "unused-pkg": "latest",
        },
      }),
      "app/page.tsx": [
        "export default function Page() { return null; }",
        "export const metadata = {};",
        "export const generateStaticParams = () => [];",
        "export const Extra = 1;",
      ].join("\n"),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "unused-dependency",
      "unused-export",
    ]);
    expect(result.issues.map((issue) => issue.id).join("\n")).not.toContain("next");
    expect(result.issues.map((issue) => issue.id).join("\n")).toContain("unused-pkg");
  });

  it("treats common tooling config files as support entrypoints", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        devDependencies: {
          eslint: "latest",
          tailwindcss: "latest",
          postcss: "latest",
          "@playwright/test": "latest",
          tsup: "latest",
        },
      }),
      "eslint.config.ts": "export default [];\n",
      "tailwind.config.ts": "export default {};\n",
      "postcss.config.ts": "export default {};\n",
      "playwright.config.ts": "export default {};\n",
      "tsup.config.ts": "export default {};\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues).toEqual([]);
  });

  it("maps published package entry fields back to source files", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        main: "./dist/index.js",
        types: "./dist/types.d.ts",
        bin: {
          fixture: "./dist/cli.js",
        },
        exports: {
          ".": {
            import: "./dist/index.js",
            types: "./dist/types.d.ts",
          },
        },
      }),
      "src/index.ts": "export const publicValue = 1;\n",
      "src/types.ts": "export interface PublicType { value: string }\n",
      "src/cli.ts": "console.log('fixture');\n",
      "src/dead.ts": "console.log('dead');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/src/dead.ts`,
    ]);
  });

  it("maps package entry fields through tsconfig rootDir and outDir", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        main: "./lib/index.js",
        types: "./lib/types.d.ts",
        bin: {
          fixture: "./lib/cli.js",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "./tsconfig.base.json",
      }),
      "tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          rootDir: "source",
          outDir: "lib",
        },
      }),
      "source/index.ts": "export const publicValue = 1;\n",
      "source/types.ts": "export interface PublicType { value: string }\n",
      "source/cli.ts": "console.log('fixture');\n",
      "source/dead.ts": "console.log('dead');\n",
      "lib/index.js": "export const publicValue = 1;\n",
      "lib/cli.js": "console.log('compiled fixture');\n",
      "lib/generated.js": "console.log('compiled generated');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/source/dead.ts`,
    ]);
  });

  it("maps package entry fields through referenced tsconfig source maps", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        main: "./build/index.js",
      }),
      "tsconfig.json": JSON.stringify({
        references: [{ path: "./tsconfig.build.json" }],
      }),
      "tsconfig.build.json": JSON.stringify({
        compilerOptions: {
          rootDir: "app",
          outDir: "build",
        },
      }),
      "app/index.ts": "export const publicValue = 1;\n",
      "app/dead.ts": "console.log('dead');\n",
      "build/index.js": "export const publicValue = 1;\n",
      "build/generated.js": "console.log('compiled generated');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/app/dead.ts`,
    ]);
  });

  it("discovers modern JavaScript and TypeScript module extensions", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        main: "./src/index.mjs",
        types: "./dist/types.d.mts",
        bin: {
          fixture: "./src/cli.cjs",
        },
      }),
      "src/index.mjs": "import { used } from './lib.cjs';\nconsole.log(used);\n",
      "src/lib.cjs": "exports.used = 1;\nexports.unused = 2;\n",
      "src/types.mts": "export interface PublicType { value: string }\n",
      "src/cli.cjs": "console.log('cli');\n",
      "src/dead.cts": "console.log('dead');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-export/src/lib.cjs/unused`,
      `${DEAD_CODE_RULE_ID}/unused-file/src/dead.cts`,
    ]);
  });

  it("counts package scripts, manifest config, and side effects as usage", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        scripts: {
          build: "tsc -p tsconfig.json && eslint src",
        },
        prettier: {
          plugins: ["prettier-plugin-tailwindcss"],
        },
        sideEffects: ["./src/register.ts"],
        dependencies: {
          eslint: "latest",
          "prettier-plugin-tailwindcss": "latest",
          typescript: "latest",
          "unused-pkg": "latest",
        },
      }),
      "src/main.ts": "console.log('main');\n",
      "src/register.ts": "console.log('register');\n",
      "src/dead.ts": "console.log('dead');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "unused-dependency",
      "unused-file",
    ]);
    const issueIds = result.issues.map((issue) => issue.id).join("\n");
    expect(issueIds).not.toContain("eslint");
    expect(issueIds).not.toContain("prettier-plugin-tailwindcss");
    expect(issueIds).not.toContain("typescript");
    expect(issueIds).not.toContain("src/register.ts");
    expect(issueIds).toContain("unused-pkg");
    expect(issueIds).toContain("src/dead.ts");
  });

  it("reports packages used by scripts and manifest config when unlisted", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        scripts: {
          build: "tsc -p tsconfig.json && eslint src",
        },
        prettier: {
          plugins: ["prettier-plugin-tailwindcss"],
        },
      }),
      "src/main.ts": "console.log('main');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId)).toEqual([
      "unlisted-dependency",
      "unlisted-dependency",
      "unlisted-dependency",
    ]);
    expect(result.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./eslint`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./prettier-plugin-tailwindcss`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./typescript`,
    ]);
  });

  it("counts package-manager script runners as binary dependency usage", async () => {
    const usedRootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        scripts: {
          lint: "pnpm exec eslint src",
          test: "npx playwright test",
          build: "cross-env NODE_ENV=production pnpm exec tsup",
          start: "NODE_OPTIONS='--require ts-node/register --import tsx' node src/main.ts",
        },
        devDependencies: {
          "@playwright/test": "latest",
          "cross-env": "latest",
          eslint: "latest",
          "ts-node": "latest",
          tsup: "latest",
          tsx: "latest",
          "unused-dev": "latest",
        },
      }),
      "src/main.ts": "console.log('main');\n",
    });

    const usedResult = await inspectReactProject({
      rootDirectory: usedRootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(usedResult.issues.map((issue) => issue.id)).toEqual([
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./unused-dev`,
    ]);

    const unlistedRootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        scripts: {
          lint: "pnpm exec eslint src",
          test: "npx playwright test",
          build: "bunx tsx scripts/build.ts",
          start: "NODE_OPTIONS='--require ts-node/register --import tsx' node src/main.ts",
        },
      }),
      "src/main.ts": "console.log('main');\n",
    });

    const unlistedResult = await inspectReactProject({
      rootDirectory: unlistedRootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(unlistedResult.issues.map((issue) => issue.id).sort()).toEqual([
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./@playwright/test`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./eslint`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./ts-node`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./tsx`,
    ]);
  });

  it("counts TypeScript config dependencies as usage", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        devDependencies: {
          "@emotion/react": "latest",
          "@tsconfig/node22": "latest",
          "@types/node": "latest",
          "ts-plugin": "latest",
          tslib: "latest",
          "unused-dev": "latest",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: ["@tsconfig/node22/tsconfig.json", "@tsconfig/missing/tsconfig.json"],
        compilerOptions: {
          importHelpers: true,
          jsxImportSource: "@emotion/react",
          plugins: [{ name: "ts-plugin" }],
          types: ["node", "missing"],
        },
      }),
      "src/main.ts": "console.log('main');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./@tsconfig/missing`,
      `${DEPENDENCIES_RULE_ID}/unlisted-dependency/./@types/missing`,
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./unused-dev`,
    ]);
  });

  it("reports devDependencies imported by runtime code", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        devDependencies: {
          "runtime-only-dev": "latest",
          "test-only-dev": "latest",
          "type-only-dev": "latest",
        },
      }),
      "src/main.ts": [
        "import runtimeValue from 'runtime-only-dev';",
        "import type { TypeOnly } from 'type-only-dev';",
        "const value: TypeOnly = runtimeValue;",
        "console.log(value);",
      ].join("\n"),
      "src/example.test.ts": "import testValue from 'test-only-dev';\nconsole.log(testValue);\n",
      "node_modules/runtime-only-dev/package.json": JSON.stringify({
        name: "runtime-only-dev",
        main: "index.js",
      }),
      "node_modules/runtime-only-dev/index.js": "export default 'runtime';\n",
      "node_modules/test-only-dev/package.json": JSON.stringify({
        name: "test-only-dev",
        main: "index.js",
      }),
      "node_modules/test-only-dev/index.js": "export default 'test';\n",
      "node_modules/type-only-dev/package.json": JSON.stringify({
        name: "type-only-dev",
        main: "index.js",
      }),
      "node_modules/type-only-dev/index.js": "export const value = 'type';\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId)).toEqual(["runtime-dev-dependency"]);
    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEPENDENCIES_RULE_ID}/runtime-dev-dependency/./runtime-only-dev`,
    ]);
  });

  it("reports unused peer and optional dependencies", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        peerDependencies: {
          "unused-peer": "latest",
          "unused-optional-peer": "latest",
        },
        peerDependenciesMeta: {
          "unused-optional-peer": {
            optional: true,
          },
        },
        optionalDependencies: {
          "unused-optional": "latest",
        },
      }),
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId).sort()).toEqual([
      "unused-optional-dependency",
      "unused-optional-peer-dependency",
      "unused-peer-dependency",
    ]);
  });

  it("reports packages declared in multiple dependency buckets", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        dependencies: {
          duplicated: "latest",
        },
        devDependencies: {
          duplicated: "latest",
        },
      }),
      "src/main.ts": "import duplicated from 'duplicated';\nconsole.log(duplicated);\n",
      "node_modules/duplicated/package.json": JSON.stringify({
        name: "duplicated",
        main: "index.js",
      }),
      "node_modules/duplicated/index.js": "export default 'duplicated';\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.source?.ruleId)).toEqual([
      "duplicate-dependency-declaration",
    ]);
    expect(result.issues[0]?.message).toContain("dependencies, devDependencies");
  });

  it("keeps DefinitelyTyped companions used with their runtime packages", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        dependencies: {
          "left-pad": "latest",
          "@scope/runtime": "latest",
        },
        devDependencies: {
          "@types/left-pad": "latest",
          "@types/scope__runtime": "latest",
          "@types/node": "latest",
          "@types/unused": "latest",
        },
      }),
      "src/main.ts": [
        "import leftPad from 'left-pad';",
        "import runtime from '@scope/runtime';",
        "console.log(leftPad, runtime);",
      ].join("\n"),
      "node_modules/left-pad/package.json": JSON.stringify({
        name: "left-pad",
        main: "index.js",
      }),
      "node_modules/left-pad/index.js": "export default 'left-pad';\n",
      "node_modules/@scope/runtime/package.json": JSON.stringify({
        name: "@scope/runtime",
        main: "index.js",
      }),
      "node_modules/@scope/runtime/index.js": "export default 'runtime';\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEPENDENCIES_RULE_ID}/unused-dev-dependency/./@types/unused`,
    ]);
  });

  it("accounts for workspace package imports as dependencies", async () => {
    const declaredRootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@scope/app",
        dependencies: {
          "@scope/ui": "workspace:*",
          "unused-prod": "latest",
        },
      }),
      "packages/app/src/main.ts": "import { Button } from '@scope/ui';\nconsole.log(Button);\n",
      "packages/ui/package.json": JSON.stringify({
        name: "@scope/ui",
      }),
      "packages/ui/src/index.ts": "export const Button = 'button';\n",
    });

    const declaredResult = await inspectReactProject({
      rootDirectory: declaredRootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(declaredResult.issues.map((issue) => issue.source?.ruleId)).toEqual([
      "unused-dependency",
    ]);
    expect(declaredResult.issues.map((issue) => issue.id).join("\n")).not.toContain("@scope/ui");
    expect(declaredResult.issues.map((issue) => issue.id).join("\n")).toContain("unused-prod");

    const unlistedRootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@scope/app",
      }),
      "packages/app/src/main.ts": "import { Button } from '@scope/ui';\nconsole.log(Button);\n",
      "packages/ui/package.json": JSON.stringify({
        name: "@scope/ui",
      }),
      "packages/ui/src/index.ts": "export const Button = 'button';\n",
    });

    const unlistedResult = await inspectReactProject({
      rootDirectory: unlistedRootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEPENDENCIES_RULE_ID],
      },
    });

    expect(unlistedResult.issues.map((issue) => issue.source?.ruleId)).toEqual([
      "unlisted-dependency",
    ]);
    expect(unlistedResult.issues.map((issue) => issue.id).join("\n")).toContain("@scope/ui");
  });

  it("resolves workspace package subpaths and self-references", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/app/package.json": JSON.stringify({
        name: "@scope/app",
        dependencies: {
          "@scope/ui": "workspace:*",
        },
        exports: {
          "./utils": "./src/utils.ts",
        },
      }),
      "packages/app/src/main.ts": [
        "import { Button } from '@scope/ui/button';",
        "import { WildcardButton } from '@scope/ui/widgets/wildcard-button';",
        "import { selfUtil } from '@scope/app/utils';",
        "console.log(Button, WildcardButton, selfUtil);",
      ].join("\n"),
      "packages/app/src/utils.ts": "export const selfUtil = 'self';\n",
      "packages/ui/package.json": JSON.stringify({
        name: "@scope/ui",
        exports: {
          "./button": "./dist/button.js",
          "./widgets/*": "./lib/components/*.js",
        },
      }),
      "packages/ui/tsconfig.json": JSON.stringify({
        compilerOptions: {
          rootDir: "src",
          outDir: "lib",
        },
      }),
      "packages/ui/src/button.ts":
        "export const Button = 'button';\nexport const Unused = 'unused';\n",
      "packages/ui/src/components/wildcard-button.ts": "export const WildcardButton = 'button';\n",
      "packages/ui/src/private.ts": "export const Private = 'private';\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/packages/ui/src/private.ts`,
    ]);
  });

  it("discovers pnpm workspaces only from the packages section", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        private: true,
      }),
      "pnpm-workspace.yaml": [
        "packages:",
        "  - 'packages/*'",
        "  - '!packages/excluded'",
        "catalog:",
        "  - ignored/*",
      ].join("\n"),
      "packages/app/package.json": JSON.stringify({
        name: "@scope/app",
        dependencies: {
          "@scope/ui": "workspace:*",
        },
      }),
      "packages/app/src/main.ts": "import { Button } from '@scope/ui';\nconsole.log(Button);\n",
      "packages/ui/package.json": JSON.stringify({
        name: "@scope/ui",
      }),
      "packages/ui/src/index.ts": "export const Button = 'button';\n",
      "packages/excluded/package.json": JSON.stringify({
        name: "@scope/excluded",
        main: "src/index.ts",
      }),
      "packages/excluded/src/index.ts": "console.log('excluded workspace candidate');\n",
      "ignored/pkg/package.json": JSON.stringify({
        name: "ignored-pkg",
        main: "src/index.ts",
      }),
      "ignored/pkg/src/index.ts": "console.log('ignored workspace candidate');\n",
    });

    const result = await inspectReactProject({
      rootDirectory,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID],
      },
    });

    expect(result.issues.map((issue) => issue.id)).toEqual([
      `${DEAD_CODE_RULE_ID}/unused-file/ignored/pkg/src/index.ts`,
      `${DEAD_CODE_RULE_ID}/unused-file/packages/excluded/src/index.ts`,
    ]);
  });

  it("runs the full-port fixture across workspaces, paths, deps, and architecture", async () => {
    const result = await inspectReactProject({
      rootDirectory: FULL_PORT_FIXTURE_PATH,
      rules: {
        disabledRuleIds: [PROJECT_STRUCTURE_RULE_ID],
        enabledRuleIds: [DEAD_CODE_RULE_ID, DEPENDENCIES_RULE_ID, REACT_ARCHITECTURE_RULE_ID],
      },
    });

    const ruleIds = new Set(result.issues.map((issue) => issue.source?.ruleId));

    expect(result.checks).toHaveLength(3);
    expect([...ruleIds]).toEqual(
      expect.arrayContaining([
        "unused-export",
        "unused-dependency",
        "unused-dev-dependency",
        "unused-optional-peer-dependency",
        "type-only-dependency",
        "test-only-dependency",
        "client-server-boundary",
        "barrel-hotspot",
        "circular-import",
      ]),
    );
  });
});
