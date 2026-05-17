// Per-rule divergences between our TypeScript port of the React-team
// `eslint-plugin-react-hooks` rules and the upstream test fixtures.
// Each entry lists the 0-based index into upstream's `valid:` /
// `invalid:` arrays plus the reason — usually because the upstream
// rule depends on capabilities our visitor-only plugin doesn't have
// (Flow `component` / `hook` syntax, full hermes-eslint scope chain,
// useEffectEvent semantics, deep ref-current write tracking).
//
// Adding a new entry should always include a one-line reason.

export interface UpstreamDivergence {
  validSkips?: ReadonlyArray<number>;
  invalidSkips?: ReadonlyArray<number>;
  reason: string;
}

export const RULES_OF_HOOKS_DIVERGENCES: UpstreamDivergence = {
  invalidSkips: [0, 1, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76],
  reason:
    "Remaining gaps: Flow `component` / `hook` syntax (cases 0, 1; require a hermes-eslint Flow parser) and useEffectEvent placement rules (60-76; an entirely separate detection layer that tracks where useEffectEvent's return value is allowed to appear — only inside other-effect callbacks, never in JSX or component bodies — not yet implemented).",
};

export const EXHAUSTIVE_DEPS_DIVERGENCES: UpstreamDivergence = {
  validSkips: [
    6, 20, 22, 23, 31, 32, 52, 53, 55, 56, 69, 71, 72, 75, 76, 77, 80, 81, 83, 85, 87, 88, 90, 92,
    93, 98, 111, 113, 114, 115, 117,
  ],
  invalidSkips: [
    0, 2, 7, 10, 11, 12, 16, 21, 25, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 46,
    47, 48, 49, 50, 54, 55, 56, 57, 58, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 73, 74, 75, 76, 79,
    81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 98, 99, 100, 101, 105, 106, 107,
    108, 109, 110, 111, 112, 113, 115, 119, 125, 129, 130, 131, 132, 133, 134, 135, 137, 138, 139,
    140, 141, 142, 143, 144, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
    160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 178, 179,
    180, 181, 182, 187, 188, 189, 190,
  ],
  reason:
    "useState-setter / useRef stable-identity detection, useEffectEvent hoisting, deep TS-aware unwrapping (typeof + as casts + satisfies), useMemo / useCallback dep-array suggestion text, and React 19 `use()` semantics inside dep arrays not yet replicated.",
};
