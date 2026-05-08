import type { StepState } from "../types.js";
import { ProgressChecklist } from "./progress-checklist.js";
import { Tile } from "./tile.js";

interface ProgressTileProps {
  steps: StepState[];
}

export const ProgressTile = ({ steps }: ProgressTileProps) => (
  <Tile title="Scanning…" accent="cyan" flexGrow={1}>
    <ProgressChecklist steps={steps} />
  </Tile>
);
