import { Box } from "ink";
import type { AppState } from "../types.js";
import { colorForScore } from "../utils/color-for-score.js";
import { moodFromState } from "../utils/mood-from-state.js";
import { DoctorFace } from "./doctor-face.js";
import { ScoreGauge } from "./score-gauge.js";
import { Tile } from "./tile.js";

interface HealthTileProps {
  state: AppState;
  scoreBarWidth: number;
  showHistory: boolean;
}

const accentForState = (state: AppState): string => {
  if (state.scanStatus === "scanning") return "cyan";
  if (state.scanStatus === "error") return "red";
  if (state.score) return colorForScore(state.score.score);
  return "gray";
};

export const HealthTile = ({ state, scoreBarWidth, showHistory }: HealthTileProps) => (
  <Tile title="Health" accent={accentForState(state)} flexGrow={1}>
    <Box>
      <DoctorFace mood={moodFromState(state)} isAnimating={state.scanStatus === "scanning"} />
      <Box marginLeft={2} flexDirection="column" flexGrow={1}>
        <ScoreGauge
          score={state.score?.score ?? null}
          label={state.score?.label ?? null}
          previousScore={state.previousScore?.score ?? null}
          isOffline={state.isOffline}
          history={state.scoreHistory}
          barWidth={scoreBarWidth}
          showHistory={showHistory}
        />
      </Box>
    </Box>
  </Tile>
);
