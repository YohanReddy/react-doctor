import { APP_ROUTER_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const EXPENSIVE_SERVER_CALL_PATTERN =
  /(?:fetch|query|findMany|findUnique|select|getUser|getSession|getCurrentUser)/;

export const serverCacheReact = defineRule<Rule>({
  id: "server-cache-react",
  severity: "warn",
  recommendation:
    "Wrap shared server reads in React cache() so sibling Server Components dedupe the same request-scoped work",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!APP_ROUTER_FILE_PATTERN.test(filename)) return;
        if (!node.async) return;
        if (!node.id?.name || /^generate(?:Metadata|StaticParams)$/.test(node.id.name)) return;
        const body = node.body;
        if (!body) return;
        for (const statement of body.body ?? []) {
          if (!isNodeOfType(statement, "VariableDeclaration")) continue;
          const declarator = statement.declarations?.[0];
          const init = declarator?.init;
          const call = isNodeOfType(init, "AwaitExpression") ? init.argument : init;
          if (!isNodeOfType(call, "CallExpression")) continue;
          const callee = call.callee;
          const calleeName = isNodeOfType(callee, "Identifier")
            ? callee.name
            : isNodeOfType(callee, "MemberExpression") &&
                isNodeOfType(callee.property, "Identifier")
              ? callee.property.name
              : null;
          if (!calleeName || !EXPENSIVE_SERVER_CALL_PATTERN.test(calleeName)) continue;
          context.report({
            node: statement,
            message:
              "server helper performs request-scoped async work without React.cache() — wrap shared reads in cache() so sibling Server Components dedupe the same request",
          });
          return;
        }
      },
    };
  },
});
