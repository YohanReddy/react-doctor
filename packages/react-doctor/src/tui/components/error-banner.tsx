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
  <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginBottom={1}>
    <Box>
      <Text color="red" bold>
        ✗ Scan failed{" "}
      </Text>
      <Text color="white">{truncate(message, 200)}</Text>
    </Box>
    {hint ? (
      <Box marginTop={1}>
        <Text color="gray">→ {hint}</Text>
      </Box>
    ) : null}
  </Box>
);
