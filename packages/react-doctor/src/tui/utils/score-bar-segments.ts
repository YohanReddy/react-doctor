import { PERFECT_SCORE, SCORE_BAR_WIDTH_CHARS } from "../constants.js";

export interface ScoreBarSegments {
  filledSegment: string;
  emptySegment: string;
  filledCount: number;
}

export const buildScoreBarSegments = (
  score: number,
  width: number = SCORE_BAR_WIDTH_CHARS,
): ScoreBarSegments => {
  const clampedScore = Math.max(0, Math.min(PERFECT_SCORE, score));
  const filledCount = Math.round((clampedScore / PERFECT_SCORE) * width);
  const emptyCount = Math.max(0, width - filledCount);
  return {
    filledSegment: "█".repeat(filledCount),
    emptySegment: "░".repeat(emptyCount),
    filledCount,
  };
};
