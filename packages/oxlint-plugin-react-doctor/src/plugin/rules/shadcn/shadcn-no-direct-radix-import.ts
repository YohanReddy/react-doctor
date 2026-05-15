import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceValue } from "../../utils/get-import-source-value.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const RADIX_PRIMITIVE_IMPORT_PATTERN = /^@radix-ui\/react-/;
const SHADCN_WRAPPER_PATH_PATTERN = /(?:^|[/\\])components[/\\]ui[/\\][^/\\]+\.[cm]?[jt]sx?$/;

export const shadcnNoDirectRadixImport = defineRule<Rule>({
  id: "shadcn-no-direct-radix-import",
  severity: "warn",
  recommendation:
    "Import the local shadcn/ui wrapper from components/ui instead of importing Radix primitives directly in product code",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (SHADCN_WRAPPER_PATH_PATTERN.test(context.getFilename?.() ?? "")) return;
      const source = getImportSourceValue(node);
      if (!source || !RADIX_PRIMITIVE_IMPORT_PATTERN.test(source)) return;
      context.report({
        node,
        message: `${source} imported directly — use the project's shadcn/ui wrapper so styling, tokens, and accessibility conventions stay centralized`,
      });
    },
  }),
});
