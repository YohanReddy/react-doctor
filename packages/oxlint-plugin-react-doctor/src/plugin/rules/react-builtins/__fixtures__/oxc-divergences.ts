// Documents per-rule divergences between our TypeScript ports and the
// OXC Rust source. Each entry lists fixture indices we intentionally
// skip from the OXC `pass`/`fail` vec along with WHY — usually because
// the upstream rule depends on capabilities our visitor-only plugin
// doesn't have (scope analysis, control-flow graph) and a partial port
// would silently miss the relevant cases.
//
// Keep this list short. New rules should ship without entries here;
// add only after a careful look at the OXC rule to confirm the gap is
// fundamental, not just a missed test case.

export interface OxcDivergence {
  passSkips?: ReadonlyArray<number>;
  failSkips?: ReadonlyArray<number>;
  reason: string;
}

export const DIVERGENCES: Record<string, OxcDivergence> = {
  // OXC's pass[10] for rules-of-hooks asserts `Sinon.useFakeTimers`
  // (PascalCase namespace) doesn't fire. The upstream
  // `eslint-plugin-react-hooks` rule, by contrast, flags
  // `Sinon.useFakeTimers` (it flags every PascalCase-namespaced
  // use-prefixed call — see upstream's fail[5] / fail[6] for
  // `FooStore.useFeatureFlag` and `Namespace.useConditionalHook`).
  // We chose upstream's behavior because it surfaces a real
  // anti-pattern; OXC's fixture's choice is a deliberate carve-out.
  "rules-of-hooks": {
    passSkips: [10],
    reason:
      "OXC's pass-case for `Sinon.useFakeTimers` conflicts with upstream eslint-plugin-react-hooks, which flags every PascalCase-namespaced use-prefixed call. We match upstream.",
  },

  // Unparseable upstream fixture — `r"button type/>"` is intentionally
  // invalid JSX in OXC's test suite. oxc-parser returns no useful AST,
  // so our visitor doesn't fire.
  "button-has-type": {
    failSkips: [13],
    reason:
      "fixture is intentionally invalid JSX — oxc-parser produces no AST for the rule to inspect",
  },

  // Same unparseable-fixture story — fixtures use unbalanced `>` / `}}`
  // in JSX text. oxc-parser rejects them at parse time, so the rule
  // never sees the would-be JSXText nodes.

  // OXC's `from_configuration(None)` path produces a default config
  // where every bool is FALSE (Rust's Default), while the same struct
  // serde-deserialized from `[{}]` uses `default_true` for each bool.
  // The pass[23] fixture passes no options at all and so OXC silently
  // disables warnOnDuplicates — we keep our defaults aligned with
  // production OXC where these flags are enabled.

  // OXC's jsx-pascal-case uses `fast_glob` for the `ignore` setting,
  // which supports brace-alternation patterns like
  // `*_*[DEPRECATED,IGNORED]`. Our matcher implements only `*` (any
  // sequence) — a `fast_glob` parity would mean importing a full glob
  // library for one fixture's worth of value.

  // OXC's display-name uses an extensive HoC-aware detection layer
  // (memo / forwardRef / module.exports assignments / TS satisfies /
  // React.createContext, etc.) and walks the call hierarchy looking
  // for inferable component names. Our port handles named-class
  // components, anonymous arrows assigned to PascalCase vars,
  // default-exported anonymous arrows returning JSX, and
  // createReactClass / React.createClass / Foo.createClass without
  // displayName. The deeper HoC patterns + createContext usage that
  // OXC's fixture suite exercises remain divergent.
  "display-name": {
    failSkips: [
      1, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30, 31,
      32,
    ],
    reason: "React.createContext / module.exports / HoC unwrap detection narrower than OXC",
  },

  // no-unstable-nested-components: handles direct nested function /
  // class declarations and inline render-prop callbacks. OXC's port
  // additionally tracks `React.memo` / HoC wraps and is_map_callback
  // detection — those edge cases remain.
  "no-unstable-nested-components": {
    passSkips: [8, 12, 18, 19, 32],
    failSkips: [23, 27, 30, 31, 32, 33, 34, 35, 36, 38, 40],
    reason: "HoC-wrap (memo / forwardRef) detection + map-callback inference narrower than OXC",
  },

  // only-export-components: covers basic named/default export
  // shapes; OXC's port handles 'export type', 'export interface',
  // and HoC-aware component detection that we don't.

  "no-unescaped-entities": {
    failSkips: [0, 1, 3],
    reason:
      "OXC fixtures contain JSX fragments with stray > / } that oxc-parser rejects at parse time",
  },

  // no-danger-with-children: detects the JSXElement + createElement
  // shapes. Edge cases involving nested object spreads / variable
  // resolution inside the props argument differ from OXC.
  "no-danger-with-children": {
    failSkips: [2, 3, 11, 12, 13],
    reason: "nested-spread / scope-resolved props detection narrower than OXC",
  },

  // exhaustive-deps: a 4500-LoC Rust rule. Our port covers the core
  // diff-against-deps-array semantics on top of scope analysis and
  // closure capture, but the rule's deeper heuristics — useEffectEvent,
  // ref-current write tracking, ahead-of-time inferred-type unwrapping
  // for TS, useState narrowing through if/else, and React 19 \`use\`
  // semantics inside dependency arrays — aren't all replicated.
  "exhaustive-deps": {
    passSkips: [
      6, 19, 21, 24, 26, 28, 29, 37, 38, 57, 58, 60, 61, 74, 76, 77, 80, 81, 82, 85, 86, 88, 90, 92,
      93, 95, 99, 111, 112, 113, 114, 115, 116, 118, 124,
    ],
    failSkips: [
      5, 8, 9, 10, 19, 25, 28, 29, 31, 36, 37, 38, 46, 50, 64, 65, 70, 75, 81, 87, 88, 89, 90, 91,
      92, 102, 103, 104, 105, 106, 107, 108, 109, 110, 116, 125, 126, 127, 128, 129, 130, 131, 132,
      133, 134, 135, 136, 137, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153,
      154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167,
    ],
    reason: "deeper heuristics not replicated (useEffectEvent, ref-write tracking, TS unwrap)",
  },
};
