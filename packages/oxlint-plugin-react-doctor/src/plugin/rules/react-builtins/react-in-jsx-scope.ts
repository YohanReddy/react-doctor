import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasBindingNamed } from "../../utils/has-binding-named.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "`React` must be in scope when using JSX (the classic JSX transform expands `<a/>` to `React.createElement('a')`).";

const findProgramRoot = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current.type === "Program") return current;
    current = current.parent ?? null;
  }
  return null;
};

// Port of `oxc_linter::rules::react::react_in_jsx_scope`. Only relevant
// for the legacy classic JSX runtime; tsconfig `jsx: "react-jsx"` (or
// Babel's automatic runtime) makes this unnecessary. Rule fires once
// per file when JSX is used and `React` isn't a binding anywhere in the
// module.
//
// LIMITATION: we don't have scope analysis, so any `React` binding
// anywhere in the file (variable, import, parameter, etc.) suppresses
// the diagnostic — same outcome as OXC for every fixture that ships.
export const reactInJsxScope = defineRule<Rule>({
  id: "react-in-jsx-scope",
  severity: "warn",
  // Default off because the rule is obsolete for any project on React 17+
  // with the automatic JSX runtime (`jsx: "react-jsx"` in tsconfig, or
  // `runtime: "automatic"` in Babel/SWC) — which is the configuration
  // every modern React tool ships out of the box. Opt in via config if
  // you're stuck on the classic transform.
  defaultEnabled: false,
  recommendation:
    "If you're on React 17+ with the new JSX transform, disable this rule. Otherwise import `React` at the top of the file.",
  create: (context) => {
    let didCheckBindingForFile = false;
    let isReactBound = false;

    const ensureBindingChecked = (jsxNode: EsTreeNode): boolean => {
      if (didCheckBindingForFile) return isReactBound;
      didCheckBindingForFile = true;
      const programRoot = findProgramRoot(jsxNode);
      isReactBound = programRoot ? hasBindingNamed(programRoot, "React") : false;
      return isReactBound;
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (ensureBindingChecked(node)) return;
        context.report({ node: node.name, message: MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (ensureBindingChecked(node)) return;
        context.report({ node: node.openingFragment, message: MESSAGE });
      },
    };
  },
});
