import { Box, Text } from "ink";
import type { ViewMode } from "../types.js";

interface ShortcutHint {
  key: string;
  label: string;
}

interface StatusBarProps {
  viewMode: ViewMode;
  isWatching: boolean;
  isFilterActive: boolean;
}

const DASHBOARD_SHORTCUTS: ShortcutHint[] = [
  { key: "d", label: "diagnostics" },
  { key: "r", label: "rescan" },
  { key: "w", label: "toggle watch" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

const REVIEW_SHORTCUTS: ShortcutHint[] = [
  { key: "↑↓", label: "rule" },
  { key: "←→", label: "site" },
  { key: "/", label: "filter" },
  { key: "esc", label: "back" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

const FILTER_SHORTCUTS: ShortcutHint[] = [
  { key: "type", label: "filter" },
  { key: "esc", label: "cancel" },
  { key: "↵", label: "apply" },
];

export const StatusBar = ({ viewMode, isFilterActive }: StatusBarProps) => {
  const shortcuts = isFilterActive
    ? FILTER_SHORTCUTS
    : viewMode === "review"
      ? REVIEW_SHORTCUTS
      : DASHBOARD_SHORTCUTS;
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box>
        {shortcuts.map((shortcut, shortcutIndex) => (
          <Box key={shortcut.key}>
            {shortcutIndex > 0 ? <Text color="gray"> </Text> : null}
            <Text color="black" backgroundColor="cyan" bold>
              {" "}
              {shortcut.key}{" "}
            </Text>
            <Text color="gray"> {shortcut.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
