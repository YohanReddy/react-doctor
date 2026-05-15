import path from "node:path";
import type { DependencyInfo, PackageJson } from "@react-doctor/types";
import { EMPTY_DEPENDENCY_INFO, extractDependencyInfo } from "./extract-dependency-info.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { parseReactMajor } from "./parse-react-major.js";
import { readPackageJson } from "./read-package-json.js";
import { extractCatalogName, resolveCatalogVersion } from "./resolve-catalog-version.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

const getReactDeclaration = (packageJson: PackageJson) => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const reactVersion = allDependencies.react;
  return {
    catalogReference: extractCatalogName(reactVersion ?? "") ?? null,
    hasDeclaration: reactVersion !== undefined,
  };
};

const shouldReplaceReactVersion = (currentVersion: string | null, nextVersion: string): boolean => {
  if (!currentVersion) return true;

  const currentMajor = parseReactMajor(currentVersion);
  const nextMajor = parseReactMajor(nextVersion);

  if (currentMajor === null) return nextMajor !== null;
  if (nextMajor === null) return false;
  return nextMajor < currentMajor;
};

export const findReactInWorkspaces = (
  rootDirectory: string,
  packageJson: PackageJson,
): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { ...EMPTY_DEPENDENCY_INFO };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspacePackageJson);
      const reactDeclaration = getReactDeclaration(workspacePackageJson);
      const reactVersion = reactDeclaration.hasDeclaration
        ? (info.reactVersion ??
          resolveCatalogVersion(
            workspacePackageJson,
            "react",
            workspaceDirectory,
            reactDeclaration.catalogReference,
          ) ??
          resolveCatalogVersion(
            packageJson,
            "react",
            rootDirectory,
            reactDeclaration.catalogReference,
          ))
        : null;

      if (reactVersion && shouldReplaceReactVersion(result.reactVersion, reactVersion)) {
        result.reactVersion = reactVersion;
      }
      if (info.tailwindVersion && !result.tailwindVersion) {
        result.tailwindVersion = info.tailwindVersion;
      }
      if (info.framework !== "unknown" && result.framework === "unknown") {
        result.framework = info.framework;
      }

      const resultReactMajor = parseReactMajor(result.reactVersion);
      if (
        result.reactVersion &&
        result.framework !== "unknown" &&
        resultReactMajor !== null &&
        resultReactMajor <= 17
      ) {
        return result;
      }
    }
  }

  return result;
};
