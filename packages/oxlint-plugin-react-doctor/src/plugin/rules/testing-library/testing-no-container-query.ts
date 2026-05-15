import { TEST_FILE_PATTERN } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { getMemberPropertyName } from "../../utils/get-member-property-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const CONTAINER_QUERY_METHODS = new Set(["getElementById", "querySelector", "querySelectorAll"]);

export const testingNoContainerQuery = defineRule<Rule>({
  id: "testing-no-container-query",
  severity: "warn",
  recommendation:
    "Query tests through screen and accessible roles/text instead of container DOM selectors so tests exercise user-visible behavior",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isTestFile = TEST_FILE_PATTERN.test(filename);

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isTestFile) return;
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const rootName = getRootIdentifierName(node.callee);
        const methodName = getMemberPropertyName(node.callee);
        if (rootName !== "container" || !methodName || !CONTAINER_QUERY_METHODS.has(methodName)) {
          return;
        }
        context.report({
          node,
          message: `container.${methodName}() bypasses Testing Library queries — use screen.getByRole/getByText for user-visible behavior`,
        });
      },
    };
  },
});
