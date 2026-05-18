import { formatErrorChain } from "./format-error-chain.js";

/**
 * Single source of truth for the dead-code silent-fallback contract.
 *
 * Why everything in `checkDeadCode` is allowed to silently fail:
 *
 * - The analysis is **additive** — the user can still get the full
 *   lint scan, the score, and the printed diagnostics even when
 *   deslop crashes. Failing the whole scan would be a worse outcome.
 * - Failure modes are dominated by user-environment issues that the
 *   scanner cannot recover from but the user can: a missing
 *   `node_modules` (deslop walks dependencies), a malformed
 *   `tsconfig.json` that `oxc-resolver` rejects, a parser crash on
 *   an exotic source file, an ENOENT race against a file the editor
 *   just deleted, an unsupported workspace layout, etc.
 * - "Silent" specifically means: no `console.error`, no red error
 *   block, no fail-state spinner, no entry in the user-visible
 *   `skippedChecks` list, no banner at the bottom of the report.
 *   The failure reason MUST still flow into `skippedCheckReasons`
 *   under the `"dead-code"` key so `--json` consumers and bug
 *   reports can see what happened.
 *
 * Wrap the raw thrown value with `formatDeadCodeFailureReason()` to
 * get the string that belongs in `skippedCheckReasons["dead-code"]`.
 */

const FALLBACK_FAILURE_MESSAGE = "deslop dead-code analysis failed (no detail available)";

/**
 * Project a raw rejection from `checkDeadCode()` into the string that
 * belongs in `InspectResult.skippedCheckReasons["dead-code"]`. Used
 * by every silent-fallback site so the format stays consistent and
 * the rule "we never lose the cause" lives in one place.
 */
export const formatDeadCodeFailureReason = (error: unknown): string => {
  const chain = formatErrorChain(error);
  if (chain.length > 0) return chain;
  return FALLBACK_FAILURE_MESSAGE;
};
