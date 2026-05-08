import { Box, Text } from "ink";

interface SearchInputProps {
  value: string;
}

export const SearchInput = ({ value }: SearchInputProps) => (
  <Box paddingX={1}>
    <Text color="cyan" bold>
      search ▸{" "}
    </Text>
    <Text>{value}</Text>
    <Text color="gray">▌</Text>
  </Box>
);
