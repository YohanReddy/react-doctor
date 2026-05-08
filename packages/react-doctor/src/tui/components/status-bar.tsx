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

const buildDashboardShortcuts = (isWatching: boolean): ShortcutHint[] => [
  { key: "d", label: "review" },
  { key: "r", label: "rescan" },
  { key: "w", label: `watch ${isWatching ? "on" : "off"}` },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

const buildReviewShortcuts = (): ShortcutHint[] => [
  { key: "↑↓", label: "rule" },
  { key: "←→", label: "site" },
  { key: "/", label: "filter" },
  { key: "esc", label: "back" },
  { key: "q", label: "quit" },
];

const FILTER_SHORTCUTS: ShortcutHint[] = [
  { key: "type", label: "filter" },
  { key: "esc", label: "cancel" },
  { key: "↵", label: "apply" },
];

export const StatusBar = ({ viewMode, isWatching, isFilterActive }: StatusBarProps) => {
  const shortcuts = isFilterActive
    ? FILTER_SHORTCUTS
    : viewMode === "review"
      ? buildReviewShortcuts()
      : buildDashboardShortcuts(isWatching);
  return (
    <Box paddingX={1} marginTop={1}>
      {shortcuts.map((shortcut, shortcutIndex) => (
        <Box key={shortcut.key}>
          {shortcutIndex > 0 ? <Text color="gray"> </Text> : null}
          <Text color="cyan" bold>
            [{shortcut.key}]
          </Text>
          <Text color="gray"> {shortcut.label}</Text>
        </Box>
      ))}
    </Box>
  );
};
