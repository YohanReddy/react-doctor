import { RULES_OF_HOOKS_DIVERGENCES } from "./__upstream-fixtures__/divergences.js";
import { runUpstreamParity } from "./__upstream-fixtures__/run-upstream-parity.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

// Upstream-parity suite for `react-doctor/rules-of-hooks`. Each case
// here is replayed verbatim from `eslint-plugin-react-hooks`'s
// `__tests__/ESLintRulesOfHooks-test.js` fixture (`allTests.valid` /
// `allTests.invalid`). The expected error count is upstream's own
// `errors:` field — the only thing we relax is sort-order (oxlint
// emits diagnostics in source order; upstream's `RuleTester` matches
// by message-id pairs, so we count occurrences).
//
// Skipped cases are intentional divergences documented in
// `divergences.ts` adjacent to this file.
runUpstreamParity("rules-of-hooks", rulesOfHooks, {
  validSkips: RULES_OF_HOOKS_DIVERGENCES.validSkips,
  invalidSkips: RULES_OF_HOOKS_DIVERGENCES.invalidSkips,
});
