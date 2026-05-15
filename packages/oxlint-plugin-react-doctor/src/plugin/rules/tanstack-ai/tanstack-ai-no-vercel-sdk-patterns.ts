import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getNamespaceImportName } from "../../utils/get-namespace-import-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const TANSTACK_AI_IMPORT_PATTERN = /^@tanstack\/ai(?:$|[-/])/;
const VERCEL_AI_SDK_IMPORTS = new Map([
  ["ai", new Set(["generateText", "streamObject", "streamText"])],
  ["@ai-sdk/openai", new Set(["createOpenAI"])],
]);

interface IncompatibleImport {
  node: EsTreeNode;
  importedName: string;
  source: string;
}

export const tanstackAiNoVercelSdkPatterns = defineRule<Rule>({
  id: "tanstack-ai-no-vercel-sdk-patterns",
  severity: "warn",
  recommendation:
    "In TanStack AI code, use chat() from @tanstack/ai and provider adapters instead of Vercel AI SDK helpers like streamText() or createOpenAI()",
  create: (context: RuleContext) => {
    let hasTanstackAiImport = false;
    const incompatibleImports: IncompatibleImport[] = [];

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = getImportSourceValue(node);
        if (!source) return;
        if (TANSTACK_AI_IMPORT_PATTERN.test(source)) {
          hasTanstackAiImport = true;
          return;
        }
        const forbiddenNames = VERCEL_AI_SDK_IMPORTS.get(source);
        if (!forbiddenNames) return;
        for (const specifier of node.specifiers ?? []) {
          const namespaceName = getNamespaceImportName(specifier);
          if (namespaceName) {
            incompatibleImports.push({
              node: specifier,
              importedName: `${namespaceName}.*`,
              source,
            });
            continue;
          }
          const importedName = getImportedName(specifier);
          if (importedName && forbiddenNames.has(importedName)) {
            incompatibleImports.push({ node: specifier, importedName, source });
          }
        }
      },
      "Program:exit"() {
        if (!hasTanstackAiImport) return;
        for (const incompatibleImport of incompatibleImports) {
          context.report({
            node: incompatibleImport.node,
            message: `${incompatibleImport.importedName} from ${incompatibleImport.source} is a Vercel AI SDK pattern — use TanStack AI chat() and provider adapters instead`,
          });
        }
      },
    };
  },
});
