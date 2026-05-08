import type { CategoryBreakdown } from "../types.js";
import { CategoryBars } from "./category-bars.js";
import { Tile } from "./tile.js";

interface CategoriesTileProps {
  breakdown: CategoryBreakdown[];
  maxBars?: number;
}

export const CategoriesTile = ({ breakdown, maxBars }: CategoriesTileProps) => (
  <Tile title="Categories" accent="white" flexGrow={1}>
    <CategoryBars breakdown={breakdown} maxBars={maxBars} />
  </Tile>
);
