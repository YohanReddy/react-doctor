// Per-rule divergences between our TypeScript ports of OXC's jsx-a11y
// rules and the upstream Rust source. Each entry lists fixture
// indices we intentionally skip from the OXC `pass`/`fail` vec along
// with WHY.
//
// Most divergences here cite "narrower-than-OXC port" because the
// upstream rules call into deep semantic helpers (full ARIA spec
// validation, role inheritance graph, polymorphic-prop scope
// resolution) that we don't replicate verbatim.

export interface OxcDivergence {
  passSkips?: ReadonlyArray<number>;
  failSkips?: ReadonlyArray<number>;
  reason: string;
}

export const DIVERGENCES: Record<string, OxcDivergence> = {
  // alt-text: OXC's port has extensive aria-hidden / role / fallback
  // child-content checks. Our port handles the common img / area /
  // input[type=image] / object shapes only.
};
