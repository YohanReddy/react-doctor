import { REACT_19_DEPRECATION_MIN_MAJOR } from "../constants.js";

// HACK: detects whether a `react` peer-dependency range advertises
// support for any React major below 19. Used to special-case libraries:
// when a package declares `react` in `peerDependencies` and the range
// admits React 16/17/18, the library MUST keep using `forwardRef`,
// `defaultProps`, and the legacy `react-dom` root API to honor that
// peer contract — so the React-19 deprecation rules become noise.
//
// We split the raw range on the boolean operators semver allows
// between comparators (`||` for OR, `,` and whitespace for AND) and
// then read the FIRST integer of each comparator chunk. That first
// integer is the major version the comparator is talking about
// (`^17.0.0` → 17, `>=18` → 18, `<20` → 20, `19.x` → 19, `v19.0.0`
// → 19). Trailing minor/patch digits are deliberately ignored —
// matching every `\d+` would false-positive on `^19.0.0` (the `0`
// patch reads as < 19) and on canary tags like
// `0.0.0-canary-1a2b3c4d-20251230` (the hex digits inside the build
// tag look like majors).
//
// Examples:
//   "^17.0.0 || ^18.0.0 || ^19.0.0" → true (17, 18 admitted)
//   ">=17"                          → true
//   ">=18 <20"                      → true (18 admitted)
//   "17.x || 18.x || 19.x"          → true
//   "v19.0.0"                       → false
//   "^19.0.0"                       → false
//   "^19 || ^20"                    → false
//   ">=19"                          → false
//
// The `0.x` major is ignored on purpose so React experimental tags
// (`0.0.0-experimental-*`) don't masquerade as "supports legacy" and
// silently disable the migration nudge on canary checkouts.
const COMPARATOR_SEPARATOR = /[\s,|]+/;

const extractMajorFromComparator = (comparator: string): number | null => {
  const match = comparator.match(/\d+/);
  if (!match) return null;
  const major = Number.parseInt(match[0], 10);
  return Number.isFinite(major) ? major : null;
};

export const peerRangeSupportsLegacyReact = (range: string | null | undefined): boolean => {
  if (typeof range !== "string") return false;
  const trimmed = range.trim();
  if (trimmed.length === 0) return false;
  const comparators = trimmed.split(COMPARATOR_SEPARATOR);
  return comparators.some((comparator) => {
    const major = extractMajorFromComparator(comparator);
    if (major === null) return false;
    return major >= 1 && major < REACT_19_DEPRECATION_MIN_MAJOR;
  });
};
