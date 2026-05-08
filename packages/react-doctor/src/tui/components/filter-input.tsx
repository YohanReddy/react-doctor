import { Box, Text } from "ink";

interface FilterInputProps {
  value: string;
}

export const FilterInput = ({ value }: FilterInputProps) => (
  <Box paddingX={1}>
    <Text color="cyan" bold>
      filter ▸{" "}
    </Text>
    <Text>{value}</Text>
    <Text color="gray">▌</Text>
  </Box>
);
