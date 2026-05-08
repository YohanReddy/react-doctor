import { Box, Text } from "ink";
import type { ReactNode } from "react";

interface TileProps {
  title: string;
  accent?: string;
  width?: number | string;
  flexGrow?: number;
  children: ReactNode;
  trailing?: ReactNode;
}

export const Tile = ({
  title,
  accent = "gray",
  width,
  flexGrow,
  children,
  trailing,
}: TileProps) => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={accent}
    paddingX={1}
    width={width}
    flexGrow={flexGrow}
  >
    <Box justifyContent="space-between">
      <Text color={accent} bold>
        {title}
      </Text>
      {trailing ? <Box>{trailing}</Box> : null}
    </Box>
    <Box marginTop={1} flexDirection="column">
      {children}
    </Box>
  </Box>
);
