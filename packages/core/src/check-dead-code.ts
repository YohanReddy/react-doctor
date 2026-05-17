import fs from "node:fs";
import path from "node:path";
import { analyze, defineConfig } from "deslop-js";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { collectIgnorePatterns } from "./collect-ignore-patterns.js";
import { readIgnoreFile } from "./read-ignore-file.js";
import { toRelativePath } from "./utils/to-relative-path.js";

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
   * Extra patterns to exclude from analysis on top of the project's
   * `.gitignore` / `.eslintignore` / `.oxlintignore` / `.prettierignore` /
   * `.gitattributes` linguist annotations and `userConfig.ignore.files`,
   * which are auto-collected. Use this to layer call-site specific
   * exclusions on top of the defaults.
   */
  ignorePatterns?: string[];
  /**
   * Loaded react-doctor config. When provided, `ignore.files` is
   * forwarded to deslop so files the user has told react-doctor to
   * skip don't show up as "unused" or distort the reachability graph
   * for legitimate imports.
   */
  userConfig?: ReactDoctorConfig | null;
}

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

const resolveTsConfigPath = (rootDirectory: string): string | undefined => {
  for (const filename of TSCONFIG_FILENAMES) {
    const candidate = path.join(rootDirectory, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
};

// HACK: `collectIgnorePatterns` intentionally omits `.gitignore` because
// oxlint reads it automatically — deslop does not, so we pull it in
// explicitly here. Patterns are deduped before being passed to deslop
// so we don't blow up the matcher with redundant entries when the
// project repeats them across files.
const collectDeadCodeIgnorePatterns = (
  rootDirectory: string,
  userConfig: ReactDoctorConfig | null | undefined,
  extraPatterns: string[] | undefined,
): string[] => {
  const patterns: string[] = [];
  const seen = new Set<string>();
  const addPattern = (pattern: string): void => {
    if (pattern.length === 0 || seen.has(pattern)) return;
    seen.add(pattern);
    patterns.push(pattern);
  };
  for (const pattern of readIgnoreFile(path.join(rootDirectory, ".gitignore"))) {
    addPattern(pattern);
  }
  for (const pattern of collectIgnorePatterns(rootDirectory)) {
    addPattern(pattern);
  }
  for (const pattern of userConfig?.ignore?.files ?? []) {
    addPattern(pattern);
  }
  for (const pattern of extraPatterns ?? []) {
    addPattern(pattern);
  }
  return patterns;
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

// Wrap the shared `toRelativePath` helper with the same fallthrough
// behavior so deslop output is always project-relative AND uses forward
// slashes — critical on Windows, where `path.relative` returns
// `src\foo.ts` and downstream picomatch ignore-pattern matching expects
// `src/foo.ts`. Without this normalization, ignore overrides silently
// stop matching dead-code diagnostics on Windows.
const toRelativeFilePath = (rootDirectory: string, filePath: string): string => {
  const relative = toRelativePath(filePath, rootDirectory);
  return relative.length > 0 ? relative : filePath.replace(/\\/g, "/");
};

export const checkDeadCode = async (options: CheckDeadCodeOptions): Promise<Diagnostic[]> => {
  const { rootDirectory, tsConfigPath, ignorePatterns, userConfig } = options;

  // No package.json → no entry-point heuristic for deslop to use, and
  // typically not a real project. Skip silently to keep the broader
  // scan from short-circuiting on this check.
  if (!fs.existsSync(path.join(rootDirectory, "package.json"))) return [];

  const resolvedTsConfigPath = tsConfigPath ?? resolveTsConfigPath(rootDirectory);
  const effectiveIgnorePatterns = collectDeadCodeIgnorePatterns(
    rootDirectory,
    userConfig,
    ignorePatterns,
  );

  const deslopConfig = defineConfig({
    rootDir: rootDirectory,
    tsConfigPath: resolvedTsConfigPath,
    ...(effectiveIgnorePatterns.length > 0 ? { ignorePatterns: effectiveIgnorePatterns } : {}),
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
