import { Box, Text } from "ink";

const HELP_LINES: Array<{ key: string; description: string }> = [
  { key: "d", description: "switch to diagnostics review" },
  { key: "v", description: "switch to dashboard" },
  { key: "r", description: "rescan immediately" },
  { key: "w", description: "toggle watch mode" },
  { key: "↑ / ↓ / j / k", description: "navigate rules" },
  { key: "← / → / h / l", description: "navigate sites within a rule" },
  { key: "/", description: "filter diagnostics" },
  { key: "esc", description: "exit filter / back to dashboard" },
  { key: "?", description: "toggle this help" },
  { key: "q / ctrl-c", description: "quit" },
];

export const HelpOverlay = () => (
  <Box flexDirection="column" paddingX={1}>
    <Text color="cyan" bold>
      Shortcuts
    </Text>
    <Box marginTop={1} flexDirection="column">
      {HELP_LINES.map((entry) => (
        <Box key={entry.key}>
          <Box width={20}>
            <Text color="cyan">{entry.key}</Text>
          </Box>
          <Text color="gray">{entry.description}</Text>
        </Box>
      ))}
    </Box>
    <Box marginTop={1}>
      <Text color="gray">Press ? again to dismiss.</Text>
    </Box>
  </Box>
);
