import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkDeadCode } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-check-dead-code-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const writeProjectFile = (projectDirectory: string, relativePath: string, contents: string) => {
  const fullPath = path.join(projectDirectory, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
};

const setupDeslopProject = (
  caseId: string,
  files: Record<string, string>,
  packageJson: Record<string, unknown> = {},
): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      ...packageJson,
    }),
  );
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
    }),
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    writeProjectFile(projectDirectory, relativePath, contents);
  }
  return projectDirectory;
};

describe("checkDeadCode", () => {
  it("returns no diagnostics when the directory has no package.json", async () => {
    const projectDirectory = path.join(tempRoot, "no-package-json");
    fs.mkdirSync(projectDirectory, { recursive: true });

    const diagnostics = await checkDeadCode({ rootDirectory: projectDirectory });

    expect(diagnostics).toEqual([]);
  });

  it("flags files that are never imported as unused-file diagnostics", async () => {
    const projectDirectory = setupDeslopProject("unused-file", {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    });

    const diagnostics = await checkDeadCode({ rootDirectory: projectDirectory });

    const unusedFileDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "unused-file",
    );
    expect(unusedFileDiagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of unusedFileDiagnostics) {
      expect(diagnostic.plugin).toBe("deslop");
      expect(diagnostic.category).toBe("Dead Code");
      expect(diagnostic.severity).toBe("warning");
      expect(path.isAbsolute(diagnostic.filePath)).toBe(false);
    }
    expect(unusedFileDiagnostics.some((entry) => entry.filePath.endsWith("orphan.ts"))).toBe(true);
  });

  it("flags exports that no other module uses as unused-export diagnostics", async () => {
    const projectDirectory = setupDeslopProject("unused-export", {
      "src/index.ts": 'import { used } from "./helpers";\nexport const root = used();\n',
      "src/helpers.ts": "export const used = () => 1;\nexport const unused = () => 2;\n",
    });

    const diagnostics = await checkDeadCode({ rootDirectory: projectDirectory });

    const unusedExportDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "unused-export",
    );
    expect(unusedExportDiagnostics.some((entry) => entry.message.includes("unused"))).toBe(true);
    for (const diagnostic of unusedExportDiagnostics) {
      expect(diagnostic.plugin).toBe("deslop");
      expect(diagnostic.category).toBe("Dead Code");
    }
  });

  it("flags dependencies in package.json that are never imported", async () => {
    const projectDirectory = setupDeslopProject(
      "unused-dependency",
      {
        "src/index.ts": "export const root = 1;\n",
      },
      {
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "totally-unused-package": "^1.0.0",
        },
      },
    );

    const diagnostics = await checkDeadCode({ rootDirectory: projectDirectory });

    const unusedDependencyDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "unused-dependency",
    );
    expect(
      unusedDependencyDiagnostics.some((entry) => entry.message.includes("totally-unused-package")),
    ).toBe(true);
    for (const diagnostic of unusedDependencyDiagnostics) {
      expect(diagnostic.plugin).toBe("deslop");
      expect(diagnostic.filePath).toBe("package.json");
    }
  });
});
