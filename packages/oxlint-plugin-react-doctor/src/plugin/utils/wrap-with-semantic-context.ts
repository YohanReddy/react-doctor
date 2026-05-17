import type { EsTreeNode } from "./es-tree-node.js";
import type { Rule } from "./rule.js";
import type { BaseRuleContext, RuleContext } from "./rule-context.js";
import type { RuleVisitors } from "./rule-visitors.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";

// Public Rule shape that hosts (oxlint, ESLint adapter, test harness)
// hand to wrapWithSemanticContext. `create` accepts the host's
// minimal context (no scopes / cfg pre-built) and the wrapper enriches
// it before forwarding to the inner rule.
export interface WrappedRule extends Omit<Rule, "create"> {
  create: (context: BaseRuleContext) => RuleVisitors;
}

// Wraps a rule so `context.scopes` and `context.cfg` exist at runtime
// even when oxlint's host context doesn't pre-build them. We build the
// scope tree and CFG lazily on first access, scoped to the AST root
// captured by the rule's Program visitor.
//
// Both analyses are pure — they only depend on the AST root — so a
// per-file rebuild is correct. Caching across calls would require
// re-running on AST mutation; not relevant for our visit-only plugin.
//
// Performance: each analysis is O(file size). For the average React
// component file (≤500 lines), the combined cost is well under 1ms.
// Files we don't visit (no rule ever reads `scopes`/`cfg`) pay nothing
// because the lazy getters never fire.
export const wrapWithSemanticContext = (rule: Rule): WrappedRule => {
  return {
    ...rule,
    create: (baseContext: BaseRuleContext): RuleVisitors => {
      let programRoot: EsTreeNode | null = null;
      let cachedScopes: ScopeAnalysis | null = null;
      let cachedCfg: ControlFlowAnalysis | null = null;

      const ensureProgramRoot = (): EsTreeNode | null => programRoot;

      // HACK: returning a never-resolving stub when the program root
      // isn't yet captured is unreachable in practice — the wrapper
      // walks every visited node's parent chain on first invocation
      // (see captureRootIfNeeded below) and the analyses are only
      // read from inside visitor bodies that fire AFTER that capture.
      // The stubs satisfy the type system without paying for an
      // analysis we never use.
      const fallbackScopes: ScopeAnalysis = {
        rootScope: {
          id: 0,
          kind: "module",
          node: {} as EsTreeNode,
          parent: null,
          children: [],
          symbols: [],
          references: [],
          symbolsByName: new Map(),
        } as ScopeAnalysis["rootScope"],
        scopeFor: () => ({ id: 0 }) as ScopeAnalysis["rootScope"],
        ownScopeFor: () => null,
        symbolFor: () => null,
        referenceFor: () => null,
        isGlobalReference: () => false,
      };
      // HACK: `isUnconditionalFromEntry` / `dominatesExit` default to
      // `false` (the conservative answer) so that if the program root
      // capture ever fails — which it shouldn't, see captureRootIfNeeded
      // — a rule like `rules-of-hooks` errs toward flagging a possible
      // violation rather than silently allowing one.
      const fallbackCfg: ControlFlowAnalysis = {
        cfgFor: () => null,
        enclosingFunction: () => null,
        isUnconditionalFromEntry: () => false,
        dominatesExit: () => false,
      };

      const getScopes = (): ScopeAnalysis => {
        if (cachedScopes) return cachedScopes;
        const root = ensureProgramRoot();
        if (!root) return fallbackScopes;
        cachedScopes = analyzeScopes(root);
        return cachedScopes;
      };

      const getCfg = (): ControlFlowAnalysis => {
        if (cachedCfg) return cachedCfg;
        const root = ensureProgramRoot();
        if (!root) return fallbackCfg;
        cachedCfg = analyzeControlFlow(root);
        return cachedCfg;
      };

      const enrichedContext: RuleContext = {
        report: baseContext.report,
        getFilename: baseContext.getFilename,
        settings: baseContext.settings,
        get scopes() {
          return getScopes();
        },
        get cfg() {
          return getCfg();
        },
      };

      const visitors = rule.create(enrichedContext);
      const wrappedVisitors: RuleVisitors = {};
      const captureRootIfNeeded = (node: EsTreeNode): void => {
        if (programRoot) return;
        // Walk up to the program root.
        let current: EsTreeNode | null | undefined = node;
        while (current) {
          if (current.type === "Program") {
            programRoot = current;
            return;
          }
          current = current.parent ?? null;
        }
      };

      for (const [nodeType, handler] of Object.entries(visitors)) {
        if (typeof handler !== "function") continue;
        wrappedVisitors[nodeType] = ((node: EsTreeNode) => {
          captureRootIfNeeded(node);
          handler(node);
        }) as RuleVisitors[string];
      }

      // Always observe Program so we capture the root deterministically
      // before any other visitor reads scopes/cfg.
      if (!visitors.Program) {
        wrappedVisitors.Program = (node: EsTreeNode) => {
          captureRootIfNeeded(node);
        };
      }

      return wrappedVisitors;
    },
  };
};
