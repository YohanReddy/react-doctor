import { Box, Text } from "ink";

interface ErrorBannerProps {
  message: string;
  hint?: string;
}

const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
};

export const ErrorBanner = ({ message, hint }: ErrorBannerProps) => (
  <Box flexDirection="column" paddingX={1}>
    <Box>
      <Text color="red" bold>
        ✗ Scan failed{" "}
      </Text>
      <Text color="white">{truncate(message, 200)}</Text>
    </Box>
    {hint ? (
      <Box marginLeft={2}>
        <Text color="gray">→ {hint}</Text>
      </Box>
    ) : null}
  </Box>
);
