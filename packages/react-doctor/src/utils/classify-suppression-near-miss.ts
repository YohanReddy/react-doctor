import { findEnclosingMultilineJsxOpenerStart } from "./find-enclosing-jsx-opener.js";
import {
  findStackedDisableCommentsAbove,
  type StackedDisableComment,
} from "./find-stacked-disable-comments.js";
import { isRuleListedInComment } from "./is-rule-listed-in-comment.js";

const formatLineGap = (gapLineCount: number): string =>
  `${gapLineCount} line${gapLineCount === 1 ? "" : "s"}`;

const findAdjacentRuleListMismatch = (
  comments: StackedDisableComment[],
  ruleId: string,
): StackedDisableComment | undefined =>
  comments.find(
    (comment) =>
      comment.isInChain &&
      Boolean(comment.ruleList?.trim()) &&
      !isRuleListedInComment(comment.ruleList, ruleId),
  );

const findOutOfChainMatch = (
  comments: StackedDisableComment[],
  ruleId: string,
): StackedDisableComment | undefined =>
  comments.find((comment) => !comment.isInChain && isRuleListedInComment(comment.ruleList, ruleId));

const buildAdjacentMismatchHint = (comment: StackedDisableComment, ruleId: string): string => {
  const ruleListText = comment.ruleList?.trim() ?? "";
  return (
    `An adjacent react-doctor-disable-next-line at line ${comment.commentLineIndex + 1} lists "${ruleListText}" — ${ruleId} is not in that list. ` +
    `Use the comma form: react-doctor-disable-next-line ${ruleListText}, ${ruleId}`
  );
};

const buildGapHint = (
  comment: StackedDisableComment,
  diagnosticLineIndex: number,
  ruleId: string,
): string => {
  const commentLineNumber = comment.commentLineIndex + 1;
  const diagnosticLineNumber = diagnosticLineIndex + 1;
  const gapLineCount = diagnosticLineNumber - commentLineNumber - 1;
  return (
    `A react-doctor-disable-next-line for ${ruleId} sits at line ${commentLineNumber}, but ${formatLineGap(gapLineCount)} of code separate it from the diagnostic on line ${diagnosticLineNumber}. ` +
    `Move the comment immediately above line ${diagnosticLineNumber}, or extract the surrounding code into a helper so the suppression is adjacent.`
  );
};

// When a diagnostic survived the suppression filter but a nearby
// `react-doctor-disable-next-line` looks intentional, this function
// builds an explanatory hint. Two near-miss shapes get a hint:
//
//   * "wrong-rule": an in-chain comment lists rules but not this one.
//     Suggest the documented comma form.
//   * "gap-code": the rule matches but the comment isn't in the chain
//     (some code line broke the stack). Suggest moving / extracting.
//
// Returns null when no comment is in range, so unrelated diagnostics
// stay quiet. Both anchors that the suppression engine accepts (the
// diagnostic line itself, and the start of any enclosing multi-line
// JSX opener) are checked, so the hint is consistent with the
// suppression rules.
export const classifySuppressionNearMiss = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => {
  const anchorIndices = [diagnosticLineIndex];
  const openerStartIndex = findEnclosingMultilineJsxOpenerStart(lines, diagnosticLineIndex);
  if (openerStartIndex !== null && openerStartIndex > 0) {
    anchorIndices.push(openerStartIndex);
  }

  for (const anchorIndex of anchorIndices) {
    const comments = findStackedDisableCommentsAbove(lines, anchorIndex);
    const adjacentMismatch = findAdjacentRuleListMismatch(comments, ruleId);
    if (adjacentMismatch) return buildAdjacentMismatchHint(adjacentMismatch, ruleId);

    const outOfChainMatch = findOutOfChainMatch(comments, ruleId);
    if (outOfChainMatch) return buildGapHint(outOfChainMatch, diagnosticLineIndex, ruleId);
  }

  return null;
};
