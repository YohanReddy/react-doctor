import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "Class component should be written as a function component — use hooks instead.";

interface PreferFunctionComponentSettings {
  allowErrorBoundary?: boolean;
  allowJsxUtilityClass?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<PreferFunctionComponentSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { preferFunctionComponent?: PreferFunctionComponentSettings })
          .preferFunctionComponent ?? {})
      : {};
  return {
    allowErrorBoundary: ruleSettings.allowErrorBoundary ?? true,
    allowJsxUtilityClass: ruleSettings.allowJsxUtilityClass ?? false,
  };
};

const ERROR_BOUNDARY_METHODS = new Set(["componentDidCatch", "getDerivedStateFromError"]);

const isErrorBoundaryClass = (classNode: EsTreeNode): boolean => {
  const classBody = (classNode as { body?: EsTreeNode }).body;
  if (!classBody) return false;
  const members = (classBody as { body?: ReadonlyArray<EsTreeNode> }).body ?? [];
  for (const member of members) {
    if (!isNodeOfType(member, "MethodDefinition")) continue;
    const key = member.key;
    if (isNodeOfType(key, "Identifier") && ERROR_BOUNDARY_METHODS.has(key.name)) {
      return true;
    }
  }
  return false;
};

const containsJsx = (root: EsTreeNode): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (found) return;
    }
  };
  visit(root);
  return found;
};

// Port of `oxc_linter::rules::react::prefer_function_component`. Flags
// classes that look like React components and could be re-written as
// functions. By default error boundary classes (those implementing
// componentDidCatch / getDerivedStateFromError) are exempt.
//
// LIMITATION (vs OXC): OXC has additional logic to detect "JSX utility
// classes" that contain JSX but don't extend Component — we treat any
// ES6 component as a candidate.
export const preferFunctionComponent = defineRule<Rule>({
  id: "prefer-function-component",
  severity: "warn",
  // Class components are still valid React — required for error
  // boundaries (no hook equivalent), used widely in legacy code and
  // third-party libraries. Forcing rewrites by default is too
  // opinionated. Off by default.
  defaultEnabled: false,
  recommendation: "Re-write the class component as a function component using hooks.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const checkClass = (node: EsTreeNode): void => {
      if (!isEs6Component(node)) {
        if (!settings.allowJsxUtilityClass) {
          // Without isEs6Component matching, we don't flag — OXC's
          // jsx-utility-class branch is approximated by our default off.
          return;
        }
        if (!containsJsx(node)) return;
      }
      if (settings.allowErrorBoundary && isErrorBoundaryClass(node)) return;
      const reportNode = ((node as { id?: EsTreeNode }).id ?? node) as EsTreeNode;
      context.report({ node: reportNode, message: MESSAGE });
    };
    return {
      ClassDeclaration(node: EsTreeNodeOfType<"ClassDeclaration">) {
        checkClass(node);
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        checkClass(node);
      },
    };
  },
});
