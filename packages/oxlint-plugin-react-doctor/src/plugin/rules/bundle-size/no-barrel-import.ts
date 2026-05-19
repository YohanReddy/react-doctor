import { defineRule } from "../../utils/define-rule.js";
import { createRelativeImportSource } from "../../utils/create-relative-import-source.js";
import { isBarrelIndexModule } from "../../utils/is-barrel-index-module.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { resolveBarrelExportFilePath } from "../../utils/resolve-barrel-export-file-path.js";
import { resolveRelativeImportPath } from "../../utils/resolve-relative-import-path.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface RuntimeImportRequest {
  importedName: string | null;
}

const getLiteralName = (node: { type: string; name?: string; value?: unknown }): string | null => {
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
};

const getRuntimeImportRequests = (
  node: EsTreeNodeOfType<"ImportDeclaration">,
): RuntimeImportRequest[] => {
  if (node.importKind === "type") return [];

  return node.specifiers.flatMap((specifier) => {
    if (specifier.type === "ImportSpecifier") {
      if (specifier.importKind === "type") return [];
      return [{ importedName: getLiteralName(specifier.imported) }];
    }
    if (specifier.type === "ImportDefaultSpecifier") return [{ importedName: "default" }];
    return [{ importedName: null }];
  });
};

const buildReportMessage = (
  filename: string,
  barrelFilePath: string,
  importRequests: RuntimeImportRequest[],
): string => {
  const directImportSources = new Set<string>();
  for (const request of importRequests) {
    if (!request.importedName) continue;

    const directFilePath = resolveBarrelExportFilePath(barrelFilePath, request.importedName);
    if (directFilePath)
      directImportSources.add(createRelativeImportSource(filename, directFilePath));
  }

  if (directImportSources.size === 1) {
    const [directImportSource] = directImportSources;
    return `Import from barrel/index file — import directly from "${directImportSource}" for better tree-shaking`;
  }

  if (directImportSources.size > 1) {
    return `Import from barrel/index file — import directly from source modules: ${[...directImportSources].map((source) => `"${source}"`).join(", ")}`;
  }

  return "Import from barrel/index file — import directly from the source module for better tree-shaking";
};

export const noBarrelImport = defineRule<Rule>({
  id: "no-barrel-import",
  severity: "warn",
  recommendation:
    "Import from the direct path: `import { Button } from './components/Button'` instead of `./components`",
  create: (context: RuleContext) => {
    let didReportForFile = false;
    // Stories / tests / playground / examples aren't shipped to users —
    // barrel imports there don't expand the production bundle.
    const isTestlikeFile = isTestlikeFilename(context.getFilename?.());

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (isTestlikeFile) return;
        if (didReportForFile) return;

        const source = node.source?.value;
        if (typeof source !== "string" || !source.startsWith(".")) return;

        const filename = context.getFilename?.() ?? "";
        if (!filename) return;

        const importRequests = getRuntimeImportRequests(node);
        if (importRequests.length === 0) return;

        const resolvedImportPath = resolveRelativeImportPath(filename, source);
        if (resolvedImportPath && isBarrelIndexModule(resolvedImportPath)) {
          didReportForFile = true;
          context.report({
            node,
            message: buildReportMessage(filename, resolvedImportPath, importRequests),
          });
        }
      },
    };
  },
});
