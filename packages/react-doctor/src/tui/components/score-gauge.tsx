import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  PERFECT_SCORE,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_TWEEN_DURATION_MS,
  SCORE_TWEEN_FRAME_INTERVAL_MS,
} from "../constants.js";
import { colorForScore } from "../utils/color-for-score.js";

interface ScoreGaugeProps {
  score: number | null;
  label: string | null;
  previousScore: number | null;
  barWidth?: number;
}

const useTweenedScore = (targetScore: number | null): number => {
  const [displayedScore, setDisplayedScore] = useState<number>(targetScore ?? 0);
  const animationStartScoreRef = useRef<number>(targetScore ?? 0);

  useEffect(() => {
    if (targetScore === null) {
      setDisplayedScore(0);
      return undefined;
    }
    const startScore = animationStartScoreRef.current;
    const startTime = Date.now();
    const tweenInterval = setInterval(() => {
      const elapsedMilliseconds = Date.now() - startTime;
      const progress = Math.min(1, elapsedMilliseconds / SCORE_TWEEN_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const interpolated = Math.round(startScore + (targetScore - startScore) * eased);
      setDisplayedScore(interpolated);
      if (progress >= 1) {
        animationStartScoreRef.current = targetScore;
        clearInterval(tweenInterval);
      }
    }, SCORE_TWEEN_FRAME_INTERVAL_MS);
    return () => clearInterval(tweenInterval);
  }, [targetScore]);

  return displayedScore;
};

const renderDeltaBadge = (deltaValue: number): ReactElement | null => {
  if (deltaValue === 0) return null;
  const isImprovement = deltaValue > 0;
  return (
    <Text color={isImprovement ? "green" : "red"} bold>
      {"  "}
      {isImprovement ? "▲" : "▼"} {Math.abs(deltaValue)}
    </Text>
  );
};

const buildBarSegments = (score: number, width: number): { filled: string; empty: string } => {
  const clampedScore = Math.max(0, Math.min(PERFECT_SCORE, score));
  const filledCount = Math.round((clampedScore / PERFECT_SCORE) * width);
  const emptyCount = Math.max(0, width - filledCount);
  return { filled: "█".repeat(filledCount), empty: "░".repeat(emptyCount) };
};

export const ScoreGauge = ({
  score,
  label,
  previousScore,
  barWidth = SCORE_BAR_WIDTH_CHARS,
}: ScoreGaugeProps) => {
  const tweenedScore = useTweenedScore(score);
  if (score === null) {
    return (
      <Box flexDirection="column">
        <Text color="gray">— / {PERFECT_SCORE}</Text>
        <Text color="gray">{"░".repeat(barWidth)}</Text>
      </Box>
    );
  }
  const segments = buildBarSegments(tweenedScore, barWidth);
  const color = colorForScore(score);
  const delta = previousScore !== null ? score - previousScore : 0;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold>
          {tweenedScore}
        </Text>
        <Text color="gray"> / {PERFECT_SCORE}</Text>
        <Text> </Text>
        <Text color={color}>{label}</Text>
        {renderDeltaBadge(delta)}
      </Box>
      <Box>
        <Text color={color}>{segments.filled}</Text>
        <Text color="gray">{segments.empty}</Text>
      </Box>
    </Box>
  );
};
