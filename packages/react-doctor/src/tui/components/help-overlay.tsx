import { Box, Text } from "ink";
import { CANONICAL_GITHUB_URL, REACT_DOCTOR_HOME_URL } from "../../constants.js";

const HELP_LINES: Array<{ key: string; description: string }> = [
  { key: "d", description: "switch to diagnostic review" },
  { key: "v", description: "switch to dashboard" },
  { key: "r", description: "rescan immediately" },
  { key: "w", description: "toggle watch mode" },
  { key: "c", description: "copy the focused issue as agent-pasteable markdown" },
  { key: "↑ / ↓ / j / k", description: "navigate rules" },
  { key: "← / → / h / l", description: "navigate sites within a rule" },
  { key: "/", description: "search diagnostics" },
  { key: "esc", description: "exit search / close help / back to dashboard" },
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
      <Text color="gray">Press esc or ? to dismiss.</Text>
    </Box>
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color="gray">Home </Text>
        <Text color="cyan">{REACT_DOCTOR_HOME_URL}</Text>
      </Box>
      <Box>
        <Text color="gray">GitHub </Text>
        <Text color="cyan">{CANONICAL_GITHUB_URL}</Text>
      </Box>
    </Box>
  </Box>
);
