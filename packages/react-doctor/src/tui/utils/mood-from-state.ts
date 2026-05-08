import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../constants.js";
import type { AppState, DoctorMood } from "../types.js";

export const moodFromState = (state: AppState): DoctorMood => {
  if (state.scanStatus === "scanning") return "scanning";
  if (state.scanStatus === "error") return "error";
  if (!state.score) return "neutral";
  if (state.score.score >= SCORE_GOOD_THRESHOLD) return "great";
  if (state.score.score >= SCORE_OK_THRESHOLD) return "ok";
  return "bad";
};
