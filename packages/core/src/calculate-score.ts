import { FETCH_TIMEOUT_MS, PERFECT_SCORE, SCORE_API_URL, SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "./constants.js";
import type { Diagnostic, ScoreResult } from "@react-doctor/types";

const parseScoreResult = (value: unknown): ScoreResult | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("score" in value) || !("label" in value)) return null;
  const scoreValue = Reflect.get(value, "score");
  const labelValue = Reflect.get(value, "label");
  if (typeof scoreValue !== "number" || typeof labelValue !== "string") return null;
  return { score: scoreValue, label: labelValue };
};

const stripFilePaths = (diagnostics: Diagnostic[]): Omit<Diagnostic, "filePath">[] =>
  diagnostics.map(({ filePath: _filePath, ...rest }) => rest);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

const describeFailure = (error: unknown): string => {
  if (isAbortError(error)) return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

const ERROR_RULE_PENALTY = 1.5;
const WARNING_RULE_PENALTY = 0.75;

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

export const calculateScoreLocally = (diagnostics: Diagnostic[]): ScoreResult => {
  if (diagnostics.length === 0) return { score: PERFECT_SCORE, label: getScoreLabel(PERFECT_SCORE) };

  const errorRules = new Set<string>();
  const warningRules = new Set<string>();

  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (diagnostic.severity === "error") {
      errorRules.add(ruleKey);
    } else {
      warningRules.add(ruleKey);
    }
  }

  const penalty = errorRules.size * ERROR_RULE_PENALTY + warningRules.size * WARNING_RULE_PENALTY;
  const score = Math.max(0, Math.round(PERFECT_SCORE - penalty));
  return { score, label: getScoreLabel(score) };
};

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics: stripFilePaths(diagnostics) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[react-doctor] Score API returned ${response.status} ${response.statusText}`);
      return null;
    }

    return parseScoreResult(await response.json());
  } catch (error) {
    console.warn(`[react-doctor] Score API unreachable (${describeFailure(error)})`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
