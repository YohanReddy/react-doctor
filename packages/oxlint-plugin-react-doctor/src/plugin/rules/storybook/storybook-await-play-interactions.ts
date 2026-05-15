import { USER_EVENT_METHODS } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { getMemberPropertyName } from "../../utils/get-member-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const STORY_FILE_PATTERN = /\.(?:stories|story)\.[jt]sx?$/;

const isUserEventCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "userEvent" &&
  Boolean(getMemberPropertyName(node.callee));

export const storybookAwaitPlayInteractions = defineRule<Rule>({
  id: "storybook-await-play-interactions",
  severity: "error",
  recommendation:
    "Await userEvent calls inside Storybook play functions so interaction tests and snapshots observe the settled UI",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isStoryFile = STORY_FILE_PATTERN.test(filename);
    let playFunctionDepth = 0;

    return {
      Property(node: EsTreeNodeOfType<"Property">) {
        if (!isStoryFile) return;
        const keyName = isNodeOfType(node.key, "Identifier") ? node.key.name : null;
        if (keyName !== "play") return;
        const value = node.value;
        if (
          !isNodeOfType(value, "ArrowFunctionExpression") &&
          !isNodeOfType(value, "FunctionExpression")
        ) {
          return;
        }
        playFunctionDepth++;
      },
      "Property:exit"(node: EsTreeNodeOfType<"Property">) {
        if (!isStoryFile) return;
        const keyName = isNodeOfType(node.key, "Identifier") ? node.key.name : null;
        if (keyName === "play" && playFunctionDepth > 0) playFunctionDepth--;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isStoryFile || playFunctionDepth === 0) return;
        if (!isUserEventCall(node) || isNodeOfType(node.parent, "AwaitExpression")) return;
        const methodName = getMemberPropertyName(node.callee);
        if (!methodName || !USER_EVENT_METHODS.has(methodName)) return;
        context.report({
          node,
          message:
            "Storybook play userEvent call is not awaited — await the interaction before assertions or snapshots",
        });
      },
    };
  },
});
