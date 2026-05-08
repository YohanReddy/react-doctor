import type { Diagnostic, ReactDoctorConfig, ReactDoctorIgnoreOverride } from "../types.js";
import { isPlainObject } from "./is-plain-object.js";
import { compileGlobPattern } from "./match-glob-pattern.js";
import { toRelativePath } from "./to-relative-path.js";

export interface CompiledIgnoreOverride {
  filePatterns: RegExp[];
  ruleIds: ReadonlySet<string>;
}

const isIgnoreOverrideEntry = (value: unknown): value is ReactDoctorIgnoreOverride =>
  isPlainObject(value) && Array.isArray(value.files);

const collectStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const compileIgnoreOverrides = (
  userConfig: ReactDoctorConfig | null,
): CompiledIgnoreOverride[] => {
  const overrides = userConfig?.ignore?.overrides;
  if (!Array.isArray(overrides)) return [];

  return overrides.flatMap((entry) => {
    if (!isIgnoreOverrideEntry(entry)) return [];
    const filePatterns = collectStringList(entry.files).map(compileGlobPattern);
    if (filePatterns.length === 0) return [];
    const ruleIds = new Set(collectStringList(entry.rules));
    return [{ filePatterns, ruleIds }];
  });
};

// An override matches when the diagnostic's path matches any of the
// override's globs AND either the override carries no rule list (i.e.
// "ignore everything in these files") or its rule list contains the
// diagnostic's `plugin/rule` id.
export const isDiagnosticIgnoredByOverrides = (
  diagnostic: Diagnostic,
  rootDirectory: string,
  overrides: CompiledIgnoreOverride[],
): boolean => {
  if (overrides.length === 0) return false;
  const relativeFilePath = toRelativePath(diagnostic.filePath, rootDirectory);
  const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;

  return overrides.some(
    (override) =>
      override.filePatterns.some((pattern) => pattern.test(relativeFilePath)) &&
      (override.ruleIds.size === 0 || override.ruleIds.has(ruleIdentifier)),
  );
};
