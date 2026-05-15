import { TEST_OR_INFRA_FILE_PATTERN } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SERVER_OR_CLI_FILE_PATTERN =
  /\/(?:server|cli|bin|scripts|workers?|cron|jobs?|commands?|api)\//;
const EVENT_HANDLER_PROP_PATTERN = /^on[A-Z]/;
const CALLBACK_HOOK_NAMES = new Set(["useCallback", "useMemo"]);
const ANALYTICS_DEFERRABLE_OBJECTS = new Set([
  "analytics",
  "posthog",
  "mixpanel",
  "segment",
  "amplitude",
  "datadog",
  "sentry",
]);
const ANALYTICS_DEFERRABLE_METHODS = new Set([
  "track",
  "identify",
  "page",
  "capture",
  "captureMessage",
  "captureException",
  "log",
]);

const isDeferrableCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return (
    ANALYTICS_DEFERRABLE_OBJECTS.has(callee.object.name) &&
    ANALYTICS_DEFERRABLE_METHODS.has(callee.property.name)
  );
};

const isInsideEventHandlerContext = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "JSXExpressionContainer") &&
      isNodeOfType(current.parent, "JSXAttribute") &&
      isNodeOfType(current.parent.name, "JSXIdentifier") &&
      EVENT_HANDLER_PROP_PATTERN.test(current.parent.name.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(current, "CallExpression") &&
      isNodeOfType(current.callee, "Identifier") &&
      CALLBACK_HOOK_NAMES.has(current.callee.name)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

export const jsRequestIdleCallback = defineRule<Rule>({
  id: "js-request-idle-callback",
  severity: "warn",
  recommendation:
    "Schedule non-critical analytics, logging, and background work with requestIdleCallback or a timeout-backed idle scheduler",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isNonBrowserFile =
      TEST_OR_INFRA_FILE_PATTERN.test(filename) || SERVER_OR_CLI_FILE_PATTERN.test(filename);

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isNonBrowserFile) return;
        if (!isDeferrableCall(node)) return;
        if (isInsideEventHandlerContext(node)) return;
        context.report({
          node,
          message:
            "non-critical analytics/logging runs immediately — schedule it with requestIdleCallback (with a timeout if required) so input and animation work stay responsive",
        });
      },
    };
  },
});
