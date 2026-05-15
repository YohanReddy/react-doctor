/**
 * Regression tests defending against "silent drift" — places where two
 * supposedly-coupled invariants can diverge with no compile error, no
 * test failure, and no user-visible warning until the forked behavior
 * surfaces as a bug.
 *
 * Covered drift classes (all flagged by PR #249 review):
 *   1. Shared runtime exports between @react-doctor/core and
 *      @react-doctor/project-info must be re-exports, not
 *      re-declarations (runtime reference + source-level scan).
 *   2. Types exported by @react-doctor/types must not be locally
 *      re-declared in any consumer package — TypeScript would not
 *      catch a structurally-similar parallel declaration imported
 *      through a different path.
 *   3. The two "Score unavailable …" message literals must appear
 *      ONLY in their constants module, defending against an inlined
 *      copy that bypasses the imported constant.
 *   4. Workspace-facing URL constants (SCORE_API_URL, SHARE_BASE_URL)
 *      must not be inlined in any CLI source file.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import * as core from "@react-doctor/core";
import * as projectInfo from "@react-doctor/project-info";
import {
  SCORE_UNAVAILABLE_API_FAILURE_MESSAGE,
  SCORE_UNAVAILABLE_OFFLINE_MESSAGE,
} from "../../src/cli/utils/constants.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// HACK: stored repo-relative paths are normalized to forward-slashes so
// the test's comparisons (and the hardcoded `allowedRepoRelativePath`
// in the rule table) work on Windows. `path.relative()` returns
// `\`-separated paths on Windows, which would never match a `/`-style
// literal at the `!==` filter and produce a false-positive failure.
const toPosixPath = (osNativePath: string): string => osNativePath.split(path.sep).join("/");

// HACK: `packages/website/` is deployed separately as a Next.js app
// and legitimately re-declares some constants (e.g. SHARE_BASE_URL for
// SSR rendering), so it's excluded from the CLI-relevant scan scope.
const CLI_PACKAGE_SOURCE_ROOTS = [
  "packages/types/src",
  "packages/project-info/src",
  "packages/core/src",
  "packages/react-doctor/src",
  "packages/oxlint-plugin-react-doctor/src",
  "packages/eslint-plugin-react-doctor/src",
].map((relativePath) => path.join(REPO_ROOT, relativePath));

interface WorkspaceSourceFile {
  repoRelativePath: string;
  packageRelativePath: string;
  packageRoot: string;
  content: string;
}

const collectTypeScriptSources = (rootDirectories: string[]): WorkspaceSourceFile[] => {
  const sources: WorkspaceSourceFile[] = [];
  for (const packageRoot of rootDirectories) {
    if (!fs.existsSync(packageRoot)) continue;
    const directoriesToWalk: string[] = [packageRoot];
    while (directoriesToWalk.length > 0) {
      const currentDirectory = directoriesToWalk.pop();
      if (currentDirectory === undefined) continue;
      for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          directoriesToWalk.push(entryPath);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        sources.push({
          repoRelativePath: toPosixPath(path.relative(REPO_ROOT, entryPath)),
          packageRelativePath: toPosixPath(path.relative(packageRoot, entryPath)),
          packageRoot,
          content: fs.readFileSync(entryPath, "utf8"),
        });
      }
    }
  }
  return sources;
};

const ALL_WORKSPACE_SOURCES = collectTypeScriptSources(CLI_PACKAGE_SOURCE_ROOTS);

const CORE_SOURCES = ALL_WORKSPACE_SOURCES.filter((source) =>
  source.packageRoot.endsWith(path.join("packages", "core", "src")),
);

describe("shared exports between @react-doctor/core and @react-doctor/project-info (#249)", () => {
  const projectInfoExportNames = new Set(Object.keys(projectInfo));
  const sharedExportNames = Object.keys(core)
    .filter((exportName) => projectInfoExportNames.has(exportName))
    .sort();

  it("there is at least one shared runtime export to validate", () => {
    expect(sharedExportNames.length).toBeGreaterThan(0);
  });

  it.each(sharedExportNames)("%s is re-exported (not re-declared) by core", (sharedExportName) => {
    const coreValue = Reflect.get(core, sharedExportName);
    const projectInfoValue = Reflect.get(projectInfo, sharedExportName);
    // HACK: a `export type { X } from "..."` slip leaves both lookups
    // as `undefined`; `undefined === undefined` would let drift sneak
    // past. Require runtime presence first.
    expect(coreValue, `core.${sharedExportName} is undefined — use a value re-export`).not.toBe(
      undefined,
    );
    expect(projectInfoValue, `project-info.${sharedExportName} is undefined`).not.toBe(undefined);
    // HACK: `Object.is` catches re-declaration for object-typed
    // constants (RegExp, Set, etc.) because each `new X(...)` returns
    // a fresh reference, but it's blind for primitives:
    // `Object.is(52428800, 52428800)` is true even if `core` declares
    // its own copy. Scan core's source for top-of-line declarations
    // to catch the primitive case.
    const declarationPattern = new RegExp(String.raw`^export\s+const\s+${sharedExportName}\b`, "m");
    const filesWithOwnDeclaration = CORE_SOURCES.filter((source) =>
      declarationPattern.test(source.content),
    ).map((source) => source.packageRelativePath);
    expect(
      filesWithOwnDeclaration,
      `${sharedExportName}: core declares its own copy — remove and re-export from @react-doctor/project-info`,
    ).toEqual([]);
    expect(
      Object.is(coreValue, projectInfoValue),
      `${sharedExportName}: core's runtime value diverges from project-info's`,
    ).toBe(true);
  });
});

// HACK: types are stripped at runtime, so we can't enumerate them via
// `Object.keys(types)` like we do for constants. Parse the barrel's
// `export type { A, B, C } from "..."` blocks instead.
const extractTypeBarrelExports = (barrelSource: string): string[] => {
  const exportNames: string[] = [];
  for (const blockMatch of barrelSource.matchAll(/export\s+type\s*\{([^}]*)\}/g)) {
    for (const rawName of blockMatch[1].split(",")) {
      const trimmedName = rawName.trim();
      if (trimmedName.length > 0) exportNames.push(trimmedName);
    }
  }
  return exportNames.sort();
};

describe("types exported by @react-doctor/types are not re-declared in consumer packages (#249)", () => {
  const typesBarrelSource = fs.readFileSync(
    path.join(REPO_ROOT, "packages/types/src/index.ts"),
    "utf8",
  );
  const typesPackageExports = extractTypeBarrelExports(typesBarrelSource);

  const consumerSources = ALL_WORKSPACE_SOURCES.filter(
    (source) => !source.packageRoot.endsWith(path.join("packages", "types", "src")),
  );

  it("the types barrel exposes at least one named type", () => {
    expect(typesPackageExports.length).toBeGreaterThan(0);
  });

  it.each(typesPackageExports)("%s is not re-declared in any consumer package", (typeName) => {
    // HACK: ^(export\s+)?(interface|type)\s+NAME\b matches a
    // top-of-line declaration regardless of whether it's exported.
    // Re-export lines (`export type { NAME } from "..."`) don't
    // match because they have `{` between `type` and the name.
    const declarationPattern = new RegExp(
      String.raw`^(export\s+)?(interface|type)\s+${typeName}\b`,
      "m",
    );
    const filesRedeclaring = consumerSources
      .filter((source) => declarationPattern.test(source.content))
      .map((source) => source.repoRelativePath);
    expect(
      filesRedeclaring,
      `${typeName} re-declared — import from @react-doctor/types instead`,
    ).toEqual([]);
  });
});

interface MagicStringLocalityRule {
  label: string;
  literal: string;
  allowedRepoRelativePath: string;
}

const MAGIC_STRING_LOCALITY_RULES: MagicStringLocalityRule[] = [
  {
    label: "SCORE_UNAVAILABLE_OFFLINE_MESSAGE",
    literal: SCORE_UNAVAILABLE_OFFLINE_MESSAGE,
    allowedRepoRelativePath: "packages/react-doctor/src/cli/utils/constants.ts",
  },
  {
    label: "SCORE_UNAVAILABLE_API_FAILURE_MESSAGE",
    literal: SCORE_UNAVAILABLE_API_FAILURE_MESSAGE,
    allowedRepoRelativePath: "packages/react-doctor/src/cli/utils/constants.ts",
  },
  {
    label: "SCORE_API_URL",
    literal: "https://www.react.doctor/api/score",
    allowedRepoRelativePath: "packages/core/src/constants.ts",
  },
  {
    label: "SHARE_BASE_URL",
    literal: "https://www.react.doctor/share",
    allowedRepoRelativePath: "packages/core/src/constants.ts",
  },
];

describe("magic string locality — each user-facing constant has exactly one source of truth (#249)", () => {
  it.each(MAGIC_STRING_LOCALITY_RULES)(
    "$label only appears in $allowedRepoRelativePath",
    ({ literal, allowedRepoRelativePath }) => {
      const offendingFiles = ALL_WORKSPACE_SOURCES.filter(
        (source) =>
          source.repoRelativePath !== allowedRepoRelativePath && source.content.includes(literal),
      ).map((source) => source.repoRelativePath);
      expect(
        offendingFiles,
        `Inline duplicate of "${literal}" — import the constant from ${allowedRepoRelativePath} instead`,
      ).toEqual([]);
    },
  );

  // HACK: PR #259 Bugbot finding — `path.relative()` returns
  // `\`-separated paths on Windows, so a `\` in any stored
  // `repoRelativePath` would never match the forward-slash literals in
  // `MAGIC_STRING_LOCALITY_RULES` and produce a false-positive failure
  // on Windows contributors' machines. Pin that the normalization
  // (`toPosixPath` above) is actually applied.
  it("stored repo-relative paths are always POSIX-style (cross-platform safety)", () => {
    const pathsContainingBackslash = ALL_WORKSPACE_SOURCES.map(
      (source) => source.repoRelativePath,
    ).filter((repoRelativePath) => repoRelativePath.includes("\\"));
    expect(
      pathsContainingBackslash,
      "repoRelativePath should never contain `\\` — apply toPosixPath() when building WorkspaceSourceFile records",
    ).toEqual([]);
  });
});
