import { Box, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  PERFECT_SCORE,
  SCORE_BAR_WIDTH_CHARS,
  SCORE_TWEEN_DURATION_MS,
  SCORE_TWEEN_FRAME_INTERVAL_MS,
} from "../constants.js";
import type { ScoreHistoryPoint } from "../types.js";
import { colorForScore } from "../utils/color-for-score.js";
import { buildScoreBarSegments } from "../utils/score-bar-segments.js";

interface ScoreGaugeProps {
  score: number | null;
  label: string | null;
  previousScore: number | null;
  isOffline: boolean;
  history: ScoreHistoryPoint[];
  barWidth?: number;
  showHistory?: boolean;
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

const renderDeltaBadge = (deltaValue: number): ReactElement => {
  if (deltaValue === 0) {
    return <Text color="gray">±0</Text>;
  }
  const isImprovement = deltaValue > 0;
  return (
    <Text color={isImprovement ? "green" : "red"} bold>
      {isImprovement ? "▲" : "▼"} {Math.abs(deltaValue)}
    </Text>
  );
};

const SPARK_BLOCKS = "▁▂▃▄▅▆▇█";

const sparkChar = (score: number): string => {
  const clampedScore = Math.max(0, Math.min(PERFECT_SCORE, score));
  const bucketIndex = Math.min(
    SPARK_BLOCKS.length - 1,
    Math.floor((clampedScore / PERFECT_SCORE) * (SPARK_BLOCKS.length - 1)),
  );
  return SPARK_BLOCKS[bucketIndex];
};

export const ScoreGauge = ({
  score,
  label,
  previousScore,
  isOffline,
  history,
  barWidth = SCORE_BAR_WIDTH_CHARS,
  showHistory = true,
}: ScoreGaugeProps) => {
  const tweenedScore = useTweenedScore(score);
  if (score === null) {
    return (
      <Box flexDirection="column">
        <Text color="gray">— / {PERFECT_SCORE}</Text>
        <Text color="gray">{"░".repeat(barWidth)}</Text>
        <Text color="gray">no score available</Text>
      </Box>
    );
  }
  const segments = buildScoreBarSegments(tweenedScore, barWidth);
  const color = colorForScore(score);
  const delta = previousScore !== null ? score - previousScore : 0;
  const showDelta = previousScore !== null && previousScore !== score;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold>
          {tweenedScore}
        </Text>
        <Text color="gray"> / {PERFECT_SCORE}</Text>
        <Text> </Text>
        <Text color={color}>{label}</Text>
      </Box>
      <Box>
        <Text color={color}>{segments.filledSegment}</Text>
        <Text color="gray">{segments.emptySegment}</Text>
      </Box>
      {showDelta ? (
        <Box>
          {renderDeltaBadge(delta)}
          <Text color="gray"> vs last scan</Text>
        </Box>
      ) : null}
      {showHistory && history.length > 1 ? (
        <Box>
          <Text color="gray">trend </Text>
          <Text color={color}>{history.map((point) => sparkChar(point.score)).join("")}</Text>
        </Box>
      ) : null}
      {isOffline ? <Text color="gray">offline · score local</Text> : null}
    </Box>
  );
};
