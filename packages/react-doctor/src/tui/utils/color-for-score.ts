import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../constants.js";

export const colorForScore = (score: number): "green" | "yellow" | "red" => {
  if (score >= SCORE_GOOD_THRESHOLD) return "green";
  if (score >= SCORE_OK_THRESHOLD) return "yellow";
  return "red";
};
