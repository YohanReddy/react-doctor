import type { CodebasePlugin, CodebasePluginResult } from "./types.js";
import type { WorkspaceInfo } from "../types.js";

const createEmptyPluginResult = (): CodebasePluginResult => ({
  entryPatterns: [],
  alwaysUsedPatterns: [],
  usedExports: new Map(),
  toolingDependencies: new Set(),
  virtualModulePrefixes: [],
  generatedImportSuffixes: [],
});

const builtInPlugins: CodebasePlugin[] = [
  {
    name: "nextjs",
    enablers: ["next"],
    entryPatterns: [
      "app/**/page.{js,jsx,ts,tsx}",
      "app/**/layout.{js,jsx,ts,tsx}",
      "app/**/route.{js,ts}",
      "pages/**/*.{js,jsx,ts,tsx}",
      "next.config.{js,mjs,cjs,ts}",
    ],
    entryRole: "runtime",
    alwaysUsedPatterns: ["middleware.{js,ts}", "instrumentation.{js,ts}"],
    toolingDependencies: ["next"],
    usedExports: [
      {
        pattern: "app/**/{page,layout,route}.{js,jsx,ts,tsx}",
        exports: [
          "default",
          "metadata",
          "generateMetadata",
          "generateStaticParams",
          "config",
          "dynamic",
          "revalidate",
          "runtime",
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "HEAD",
          "OPTIONS",
        ],
      },
    ],
    generatedImportSuffixes: ["/$types"],
    virtualModulePrefixes: ["@/."],
  },
  {
    name: "vite",
    enablers: ["vite"],
    entryPatterns: ["index.html", "src/main.{js,jsx,ts,tsx}", "vite.config.{js,mjs,cjs,ts}"],
    entryRole: "runtime",
    toolingDependencies: ["vite"],
    virtualModulePrefixes: ["virtual:"],
  },
  {
    name: "vitest",
    enablers: ["vitest"],
    entryPatterns: ["**/*.{test,spec}.{js,jsx,ts,tsx}", "vitest.config.{js,mjs,cjs,ts}"],
    entryRole: "test",
    toolingDependencies: ["vitest"],
  },
  {
    name: "jest",
    enablers: ["jest", "ts-jest", "@jest/"],
    entryPatterns: ["**/*.{test,spec}.{js,jsx,ts,tsx}", "jest.config.{js,mjs,cjs,ts}"],
    entryRole: "test",
    toolingDependencies: ["jest", "ts-jest"],
  },
  {
    name: "eslint",
    enablers: ["eslint", "@eslint/"],
    entryPatterns: ["eslint.config.{js,mjs,cjs,ts}"],
    entryRole: "support",
    toolingDependencies: ["eslint"],
    usedExports: [{ pattern: "eslint.config.{js,mjs,cjs,ts}", exports: ["default"] }],
  },
  {
    name: "tailwindcss",
    enablers: ["tailwindcss"],
    entryPatterns: ["tailwind.config.{js,mjs,cjs,ts}"],
    entryRole: "support",
    toolingDependencies: ["tailwindcss"],
    usedExports: [{ pattern: "tailwind.config.{js,mjs,cjs,ts}", exports: ["default"] }],
  },
  {
    name: "postcss",
    enablers: ["postcss"],
    entryPatterns: ["postcss.config.{js,mjs,cjs,ts}"],
    entryRole: "support",
    toolingDependencies: ["postcss"],
    usedExports: [{ pattern: "postcss.config.{js,mjs,cjs,ts}", exports: ["default"] }],
  },
  {
    name: "playwright",
    enablers: ["@playwright/test", "playwright"],
    entryPatterns: ["playwright.config.{js,mjs,cjs,ts}"],
    entryRole: "support",
    toolingDependencies: ["@playwright/test", "playwright"],
    usedExports: [{ pattern: "playwright.config.{js,mjs,cjs,ts}", exports: ["default"] }],
  },
  {
    name: "tsup",
    enablers: ["tsup"],
    entryPatterns: ["tsup.config.{js,mjs,cjs,ts}"],
    entryRole: "support",
    toolingDependencies: ["tsup"],
    usedExports: [{ pattern: "tsup.config.{js,mjs,cjs,ts}", exports: ["default"] }],
  },
  {
    name: "storybook",
    enablers: ["storybook", "@storybook/"],
    entryPatterns: ["**/*.stories.{js,jsx,ts,tsx}", ".storybook/**/*.{js,jsx,ts,tsx}"],
    entryRole: "support",
    toolingDependencies: ["storybook"],
  },
  {
    name: "tanstack-start",
    enablers: ["@tanstack/react-start", "@tanstack/start"],
    entryPatterns: ["app/routes/**/*.{js,jsx,ts,tsx}", "src/routes/**/*.{js,jsx,ts,tsx}"],
    entryRole: "runtime",
    toolingDependencies: ["@tanstack/react-start"],
  },
  {
    name: "react-native",
    enablers: ["react-native", "expo"],
    entryPatterns: ["App.{js,jsx,ts,tsx}", "app/**/*.{js,jsx,ts,tsx}", "index.{js,jsx,ts,tsx}"],
    entryRole: "runtime",
    toolingDependencies: ["react-native", "expo"],
  },
];

const isPluginEnabled = (plugin: CodebasePlugin, workspace: WorkspaceInfo): boolean => {
  if (plugin.isEnabled?.(workspace)) return true;
  return plugin.enablers.some((enabler) => {
    if (enabler.endsWith("/")) {
      return [...workspace.dependencyNames].some((dependencyName) =>
        dependencyName.startsWith(enabler),
      );
    }
    return workspace.dependencyNames.has(enabler);
  });
};

const mergePluginResult = (
  target: CodebasePluginResult,
  plugin: CodebasePlugin,
  workspace: WorkspaceInfo,
): void => {
  target.entryPatterns.push(
    ...plugin.entryPatterns.map((pattern) => ({ pattern, role: plugin.entryRole })),
  );
  target.alwaysUsedPatterns.push(...(plugin.alwaysUsedPatterns ?? []));
  target.virtualModulePrefixes.push(...(plugin.virtualModulePrefixes ?? []));
  target.generatedImportSuffixes.push(...(plugin.generatedImportSuffixes ?? []));
  for (const dependencyName of plugin.toolingDependencies ?? []) {
    target.toolingDependencies.add(dependencyName);
  }
  for (const usedExportRule of plugin.usedExports ?? []) {
    target.usedExports.set(usedExportRule.pattern, new Set(usedExportRule.exports));
  }
  const packageJsonResult = plugin.resolvePackageJson?.(workspace.manifest);
  if (!packageJsonResult) return;
  target.entryPatterns.push(...packageJsonResult.entryPatterns);
  target.alwaysUsedPatterns.push(...packageJsonResult.alwaysUsedPatterns);
  target.virtualModulePrefixes.push(...packageJsonResult.virtualModulePrefixes);
  target.generatedImportSuffixes.push(...packageJsonResult.generatedImportSuffixes);
  for (const dependencyName of packageJsonResult.toolingDependencies) {
    target.toolingDependencies.add(dependencyName);
  }
  for (const [pattern, exportNames] of packageJsonResult.usedExports) {
    target.usedExports.set(pattern, exportNames);
  }
};

export const runCodebasePlugins = (
  workspaces: WorkspaceInfo[],
): Map<number, CodebasePluginResult> => {
  const results = new Map<number, CodebasePluginResult>();
  for (const workspace of workspaces) {
    const result = createEmptyPluginResult();
    for (const plugin of builtInPlugins) {
      if (isPluginEnabled(plugin, workspace)) {
        mergePluginResult(result, plugin, workspace);
      }
    }
    results.set(workspace.id, result);
  }
  return results;
};
