import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  DEAD_CODE_RULE_ID,
  createReactDoctor,
  inspectReactProject,
  loadReactDoctorConfig,
} from "../src/sdk/index.js";

const createFixtureProject = async (files: Record<string, string>): Promise<string> => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "react-doctor-inspect-"));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, sourceText]) => {
      const filePath = path.join(rootDirectory, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, sourceText);
    }),
  );
  return rootDirectory;
};

describe("inspectReactProject", () => {
  it("returns a scaffold run result for the target project", async () => {
    const result = await inspectReactProject({ rootDirectory: "src" });

    expect(result.status).toBe("completed");
    expect(result.project).toMatchObject({
      rootDirectory: path.resolve("src"),
      projectName: "react-doctor-v2",
      framework: "unknown",
      hasTypeScript: true,
      reactVersion: null,
      tailwindVersion: null,
      sourceFileCount: expect.any(Number),
    });
    expect(result.issues).toEqual([]);
    expect(result.checks).toEqual([
      {
        id: "react-doctor/react-project-structure",
        name: "React project structure",
        status: "completed",
        issues: [],
        durationMilliseconds: expect.any(Number),
      },
    ]);
    expect(result.score).toEqual({ value: 100, label: "Great" });
    expect(result.startedAt).toEqual(expect.any(String));
    expect(result.completedAt).toEqual(expect.any(String));
    expect(result.durationMilliseconds).toEqual(expect.any(Number));
  });

  it("can disable rules through the inspection options", async () => {
    const result = await inspectReactProject({
      rootDirectory: "src",
      rules: {
        disabledRuleIds: ["react-doctor/react-project-structure"],
      },
    });

    expect(result.checks).toEqual([]);
  });

  it("loads config from ancestors and resolves rootDir from the config source", async () => {
    const rootDirectory = await createFixtureProject({
      "react-doctor.config.json": JSON.stringify({
        rootDir: "apps/web",
        deadCode: true,
      }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        dependencies: { react: "^19.0.0" },
      }),
      "apps/web/src/main.tsx": "import { App } from './app';\nconsole.log(App);\n",
      "apps/web/src/app.tsx": "export const App = () => null;\nexport const Unused = 1;\n",
    });

    const result = await inspectReactProject({ rootDirectory });

    expect(result.project.rootDirectory).toBe(path.join(rootDirectory, "apps/web"));
    expect(result.project.projectName).toBe("web");
    expect(result.checks.map((check) => check.id)).toContain(DEAD_CODE_RULE_ID);
    expect(result.issues.map((issue) => issue.id)).toContain(
      `${DEAD_CODE_RULE_ID}/unused-export/src/app.tsx/Unused`,
    );
  });

  it("accepts offline mode in react-doctor config", async () => {
    const rootDirectory = await createFixtureProject({
      "react-doctor.config.json": JSON.stringify({ offline: true }),
      "src/main.tsx": "console.log('ok');\n",
    });

    const loadedConfig = await loadReactDoctorConfig(rootDirectory);

    expect(loadedConfig?.config.offline).toBe(true);
  });

  it("resolves Bun grouped catalog versions during project discovery", async () => {
    const rootDirectory = await createFixtureProject({
      "package.json": JSON.stringify({
        name: "workspace",
        workspaces: {
          packages: ["apps/*"],
          catalogs: {
            react19: {
              react: "^19.0.0",
            },
          },
        },
      }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        dependencies: {
          react: "catalog:react19",
        },
      }),
      "apps/web/src/main.tsx": "console.log('ok');\n",
    });

    const result = await inspectReactProject({
      rootDirectory: path.join(rootDirectory, "apps/web"),
    });

    expect(result.project.reactVersion).toBe("^19.0.0");
    expect(result.project.reactMajorVersion).toBe(19);
  });
});

describe("createReactDoctor", () => {
  it("creates a reusable advanced SDK client with default options", async () => {
    const reactDoctor = createReactDoctor({ rootDirectory: "src" });
    const result = await reactDoctor.inspect();

    expect(result.project.rootDirectory).toBe(path.resolve("src"));
  });
});
