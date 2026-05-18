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
  // only-export-components: covers basic named/default export
  // shapes; OXC's port handles 'export type', 'export interface',
  // and HoC-aware component detection that we don't.
};
