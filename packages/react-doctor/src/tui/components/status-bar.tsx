import { Box, Text } from "ink";
import type { ViewMode } from "../types.js";

interface ShortcutHint {
  key: string;
  label: string;
}

interface StatusBarProps {
  viewMode: ViewMode;
  isWatching: boolean;
  isSearchActive: boolean;
}

const buildDashboardShortcuts = (isWatching: boolean): ShortcutHint[] => [
  { key: "d", label: "review" },
  { key: "c", label: "copy issue" },
  { key: "r", label: "rescan" },
  { key: "w", label: `watch ${isWatching ? "on" : "off"}` },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

const buildReviewShortcuts = (): ShortcutHint[] => [
  { key: "↑↓", label: "rule" },
  { key: "←→", label: "site" },
  { key: "c", label: "copy" },
  { key: "/", label: "search" },
  { key: "esc", label: "back" },
  { key: "q", label: "quit" },
];

const SEARCH_SHORTCUTS: ShortcutHint[] = [
  { key: "type", label: "search" },
  { key: "esc", label: "cancel" },
  { key: "↵", label: "apply" },
];

export const StatusBar = ({ viewMode, isWatching, isSearchActive }: StatusBarProps) => {
  const shortcuts = isSearchActive
    ? SEARCH_SHORTCUTS
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
