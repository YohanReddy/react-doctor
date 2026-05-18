import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkDeadCode } from "@react-doctor/core";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-check-dead-code-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { react: "^19.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" } }),
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return projectDirectory;
};

describe("checkDeadCode", () => {
  it("returns no diagnostics when the directory has no package.json", async () => {
    const directory = path.join(tempRoot, "no-package-json");
    fs.mkdirSync(directory, { recursive: true });
    expect(await checkDeadCode({ rootDirectory: directory })).toEqual([]);
  });

  it("flags an orphan file with POSIX-separated paths under the Dead Code category", async () => {
    const directory = setupProject("unused-file", {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    });
    const diagnostics = await checkDeadCode({ rootDirectory: directory });
    const orphan = diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.plugin).toBe("deslop");
    expect(orphan?.category).toBe("Dead Code");
    expect(orphan?.filePath.includes("\\")).toBe(false);
  });

  it("honors ignore patterns from .gitignore and userConfig.ignore.files", async () => {
    const directory = setupProject("ignore-patterns", {
      "src/index.ts": "export const used = 1;\n",
      "src/gitignored.ts": "export const a = 1;\n",
      "src/configignored.ts": "export const b = 1;\n",
      ".gitignore": "src/gitignored.ts\n",
    });
    const diagnostics = await checkDeadCode({
      rootDirectory: directory,
      userConfig: { ignore: { files: ["src/configignored.ts"] } },
    });
    const flagged = diagnostics
      .filter((diagnostic) => diagnostic.rule === "unused-file")
      .map((diagnostic) => diagnostic.filePath);
    expect(flagged.some((entry) => entry.endsWith("gitignored.ts"))).toBe(false);
    expect(flagged.some((entry) => entry.endsWith("configignored.ts"))).toBe(false);
  });
});
