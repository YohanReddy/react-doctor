import { watch } from "chokidar";
import { WATCH_RESCAN_DEBOUNCE_MS } from "./constants.js";
import { createDebouncer } from "./utils/create-debouncer.js";

export interface WatcherHandle {
  close: () => Promise<void>;
}

const IGNORE_PATTERNS = [
  /(^|[\\/])\.[^\\/]/,
  /node_modules/,
  /\.next/,
  /\.turbo/,
  /\.cache/,
  /dist/,
  /build/,
  /coverage/,
];

const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?|mjs|cjs)$/;

export const startWatcher = (
  rootDirectory: string,
  onChangeDetected: () => void,
): WatcherHandle => {
  const debouncer = createDebouncer(onChangeDetected, WATCH_RESCAN_DEBOUNCE_MS);
  const watcher = watch(rootDirectory, {
    ignored: (watchedPath: string) => {
      if (IGNORE_PATTERNS.some((ignorePattern) => ignorePattern.test(watchedPath))) return true;
      return false;
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  const handleChange = (changedPath: string) => {
    if (!SOURCE_FILE_PATTERN.test(changedPath) && !changedPath.endsWith("package.json")) return;
    debouncer.schedule();
  };
  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("unlink", handleChange);
  return {
    close: async () => {
      debouncer.cancel();
      await watcher.close();
    },
  };
};
