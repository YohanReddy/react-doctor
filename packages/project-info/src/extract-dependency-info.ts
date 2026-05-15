import type { DependencyInfo, PackageJson } from "@react-doctor/types";
import { detectFramework } from "./detect-framework.js";
import { getDependencyDeclaration } from "./get-dependency-declaration.js";
import { isCatalogReference } from "./resolve-catalog-version.js";

export const EMPTY_DEPENDENCY_INFO: DependencyInfo = {
  reactVersion: null,
  tailwindVersion: null,
  framework: "unknown",
};

const pickConcreteVersion = (
  packageJson: PackageJson,
  packageName: string,
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">,
): string | null => {
  const declaration = getDependencyDeclaration({ packageJson, packageName, sections });
  if (!declaration.version || isCatalogReference(declaration.version)) return null;
  return declaration.version;
};

export const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const reactVersion = pickConcreteVersion(packageJson, "react", [
    "dependencies",
    "peerDependencies",
    "devDependencies",
  ]);
  const tailwindVersion = pickConcreteVersion(packageJson, "tailwindcss", [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ]);
  return {
    reactVersion,
    tailwindVersion,
    framework: detectFramework(allDependencies),
  };
};
