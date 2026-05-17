import fs from "node:fs";
import path from "node:path";
import { analyze, defineConfig } from "deslop-js";
import type { Diagnostic } from "@react-doctor/types";

interface CheckDeadCodeOptions {
  rootDirectory: string;
  /**
   * Tsconfig path forwarded to deslop for path-alias resolution. When
   * undefined, deslop falls back to filesystem-only resolution. The
   * react-doctor scan already resolves a tsconfig for oxlint — the same
   * value is passed through here so dead-code analysis honors the same
   * `paths` aliases.
   */
  tsConfigPath?: string;
  /**
   * Patterns to exclude from analysis. Mirrors the project's
   * `ignore.files` plus a few defaults so generated / vendored code
   * doesn't show up as "unused".
   */
  ignorePatterns?: string[];
}

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigPath = (rootDirectory: string): string | undefined => {
  for (const filename of TSCONFIG_FILENAMES) {
    const candidate = path.join(rootDirectory, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

const DEAD_CODE_PLUGIN_NAME = "deslop";
const DEAD_CODE_CATEGORY = "Dead Code";

const UNUSED_FILE_RECOMMENDATION =
  "Delete the file if it is truly unreachable, or import it from an entry point if it should be reachable.";
const UNUSED_EXPORT_RECOMMENDATION =
  "Drop the `export` keyword (or remove the declaration entirely) if no other module uses this symbol.";
const UNUSED_DEPENDENCY_RECOMMENDATION =
  "Remove the dependency from package.json if it is genuinely unused, or import it from somewhere if it should be.";
const CIRCULAR_DEPENDENCY_RECOMMENDATION =
  "Break the import cycle by extracting the shared code into a third module that both files import.";

const toRelativeFilePath = (rootDirectory: string, filePath: string): string => {
  if (!path.isAbsolute(filePath)) return filePath;
  const relative = path.relative(rootDirectory, filePath);
  return relative.length > 0 ? relative : filePath;
};

export const checkDeadCode = async (options: CheckDeadCodeOptions): Promise<Diagnostic[]> => {
  const { rootDirectory, tsConfigPath, ignorePatterns } = options;

  // No package.json → no entry-point heuristic for deslop to use, and
  // typically not a real project. Skip silently to keep the broader
  // scan from short-circuiting on this check.
  if (!fs.existsSync(path.join(rootDirectory, "package.json"))) return [];

  const resolvedTsConfigPath = tsConfigPath ?? resolveTsConfigPath(rootDirectory);

  const deslopConfig = defineConfig({
    rootDir: rootDirectory,
    tsConfigPath: resolvedTsConfigPath,
    ...(ignorePatterns && ignorePatterns.length > 0 ? { ignorePatterns } : {}),
  });

  const result = await analyze(deslopConfig);
  const diagnostics: Diagnostic[] = [];

  for (const unusedFile of result.unusedFiles) {
    diagnostics.push({
      filePath: toRelativeFilePath(rootDirectory, unusedFile.path),
      plugin: DEAD_CODE_PLUGIN_NAME,
      rule: "unused-file",
      severity: "warning",
      message: "Unused file — not reachable from any entry point",
      help: UNUSED_FILE_RECOMMENDATION,
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const unusedExport of result.unusedExports) {
    diagnostics.push({
      filePath: toRelativeFilePath(rootDirectory, unusedExport.path),
      plugin: DEAD_CODE_PLUGIN_NAME,
      rule: unusedExport.isTypeOnly ? "unused-type" : "unused-export",
      severity: "warning",
      message: unusedExport.isTypeOnly
        ? `Unused type export: \`${unusedExport.name}\``
        : `Unused export: \`${unusedExport.name}\``,
      help: UNUSED_EXPORT_RECOMMENDATION,
      line: unusedExport.line,
      column: unusedExport.column,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const unusedDependency of result.unusedDependencies) {
    diagnostics.push({
      filePath: "package.json",
      plugin: DEAD_CODE_PLUGIN_NAME,
      rule: unusedDependency.isDevDependency ? "unused-dev-dependency" : "unused-dependency",
      severity: "warning",
      message: `Unused ${unusedDependency.isDevDependency ? "devDependency" : "dependency"}: \`${unusedDependency.name}\``,
      help: UNUSED_DEPENDENCY_RECOMMENDATION,
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  for (const cycle of result.circularDependencies) {
    if (cycle.files.length === 0) continue;
    const cycleDescription = cycle.files
      .map((entry) => toRelativeFilePath(rootDirectory, entry))
      .join(" → ");
    diagnostics.push({
      filePath: toRelativeFilePath(rootDirectory, cycle.files[0]),
      plugin: DEAD_CODE_PLUGIN_NAME,
      rule: "circular-dependency",
      severity: "warning",
      message: `Circular import cycle: ${cycleDescription}`,
      help: CIRCULAR_DEPENDENCY_RECOMMENDATION,
      line: 0,
      column: 0,
      category: DEAD_CODE_CATEGORY,
    });
  }

  return diagnostics;
};
