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
  "jsx-no-new-object-as-prop": {
    // OXC flags `style={{...}}` as an inline-object-prop allocation.
    // We exempt `style` (and `dangerouslySetInnerHTML`) because both
    // are React-mandated object-shape APIs and the perf footgun is
    // unactionable on non-memoized components, where almost every
    // real hit lives. See `ALWAYS_FRESH_OBJECT_PROPS` in the rule.
    failSkips: [5],
    reason: "Intentional: skip `style` / `dangerouslySetInnerHTML` to suppress FP noise.",
  },
  "jsx-max-depth": {
    // OXC's default `max: 2` flags JSX trees that depth past 2 levels,
    // which is far too strict for real React UIs (any shadcn Card
    // exceeds it). We default `max: 10` instead and the fail[6]
    // fixture (`<div>{<div><div><span/></div></div>}</div>`, depth 4)
    // no longer exceeds the threshold.
    failSkips: [6],
    reason: "Intentional: default max raised from 2 → 10 to suppress idiomatic-React FPs.",
  },
  "only-export-components": {
    // OXC defaults `allowConstantExport: false`, which flags any
    // primitive-constant export alongside a component. We default
    // `allowConstantExport: true` because exported constants are
    // stable references that don't break Fast Refresh — matches the
    // recommended config in `eslint-plugin-react-refresh`.
    failSkips: [3, 4, 10, 14],
    reason: "Intentional: default allowConstantExport=true to suppress shadcn-style FPs.",
  },
};
