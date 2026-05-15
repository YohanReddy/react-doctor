import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { findTriggeredSideEffectCalleeName } from "./utils/find-triggered-side-effect-callee-name.js";
import { hasDocumentClassListMutation } from "./utils/has-document-class-list-mutation.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const hasEventLikeConsequent = (
  consequentNode: EsTreeNodeOfType<"IfStatement">["consequent"],
): boolean =>
  findTriggeredSideEffectCalleeName(consequentNode) !== null ||
  hasDocumentClassListMutation(consequentNode);

const hasEventLikeNode = (node: EsTreeNode): boolean =>
  findTriggeredSideEffectCalleeName(node) !== null || hasDocumentClassListMutation(node);

const collectConditionalRootNames = (
  node: EsTreeNode | null | undefined,
  into: Set<string>,
): void => {
  if (!node) return;
  const rootIdentifierName = getRootIdentifierName(node);
  if (rootIdentifierName) {
    into.add(rootIdentifierName);
    return;
  }

  if (isNodeOfType(node, "ChainExpression")) {
    collectConditionalRootNames(node.expression, into);
    return;
  }

  if (isNodeOfType(node, "UnaryExpression")) {
    collectConditionalRootNames(node.argument, into);
    return;
  }

  if (isNodeOfType(node, "BinaryExpression") || isNodeOfType(node, "LogicalExpression")) {
    collectConditionalRootNames(node.left, into);
    collectConditionalRootNames(node.right, into);
    return;
  }

  if (isNodeOfType(node, "ConditionalExpression")) {
    collectConditionalRootNames(node.test, into);
    collectConditionalRootNames(node.consequent, into);
    collectConditionalRootNames(node.alternate, into);
  }
};

const collectDependencyRootNames = (depsNode: EsTreeNodeOfType<"ArrayExpression">): Set<string> => {
  const dependencyNames = new Set<string>();
  for (const element of depsNode.elements ?? []) {
    const rootIdentifierName = getRootIdentifierName(element);
    if (rootIdentifierName) dependencyNames.add(rootIdentifierName);
  }
  return dependencyNames;
};

const isReturnOnlyStatement = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return true;
  return (
    isNodeOfType(node, "BlockStatement") &&
    (node.body?.length ?? 0) === 1 &&
    isNodeOfType(node.body?.[0], "ReturnStatement")
  );
};

const hasEventLikeRemainingStatements = (statements: EsTreeNode[]): boolean =>
  statements.some(
    (statement) => !isNodeOfType(statement, "ReturnStatement") && hasEventLikeNode(statement),
  );

export const noEffectEventHandler = defineRule<Rule>({
  id: "no-effect-event-handler",
  severity: "warn",
  recommendation:
    "Move the conditional logic into onClick, onChange, or onSubmit handlers directly",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

        const callback = getEffectCallback(node);
        if (!callback) return;

        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

        const dependencyNames = collectDependencyRootNames(depsNode);

        const statements = getCallbackStatements(callback);
        if (statements.length === 0) return;

        const soleStatement = statements[0];
        if (!isNodeOfType(soleStatement, "IfStatement")) return;

        const conditionalRootNames = new Set<string>();
        collectConditionalRootNames(soleStatement.test, conditionalRootNames);
        const hasPropDependency = [...conditionalRootNames].some(
          (rootIdentifierName) =>
            dependencyNames.has(rootIdentifierName) &&
            propStackTracker.isPropName(rootIdentifierName, node),
        );
        if (!hasPropDependency) return;

        const isSingleGuardedEventLikeStatement =
          statements.length === 1 && hasEventLikeConsequent(soleStatement.consequent);
        const isEarlyReturnGuardedEventLikeBody =
          statements.length > 1 &&
          !soleStatement.alternate &&
          isReturnOnlyStatement(soleStatement.consequent) &&
          hasEventLikeRemainingStatements(statements.slice(1));
        if (!isSingleGuardedEventLikeStatement && !isEarlyReturnGuardedEventLikeBody) return;

        context.report({
          node,
          message:
            "useEffect simulating an event handler — move logic to an actual event handler instead",
        });
      },
    };
  },
});
