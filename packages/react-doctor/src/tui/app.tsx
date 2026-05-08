import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Box, useApp, useInput } from "ink";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Diagnostic } from "react-doctor/api";
import { DashboardView } from "./components/dashboard-view.js";
import { FilterInput } from "./components/filter-input.js";
import { Header } from "./components/header.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { ReviewView } from "./components/review-view.js";
import { StatusBar } from "./components/status-bar.js";
import { SHARE_BASE_URL } from "./constants.js";
import { runScanWithListener } from "./scan-controller.js";
import { appReducer, buildInitialState } from "./store.js";
import type { AppAction } from "./types.js";
import { useTerminalSize } from "./utils/use-terminal-size.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

const writeDiagnosticsDirectory = (diagnostics: Diagnostic[]): string => {
  const outputDirectory = path.join(os.tmpdir(), `react-doctor-${crypto.randomUUID()}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  return outputDirectory;
};

const buildShareUrl = (
  diagnostics: Diagnostic[],
  score: number | null,
  projectName: string,
): string => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;
  const params = new URLSearchParams();
  params.set("p", projectName);
  if (score !== null) params.set("s", String(score));
  if (errorCount > 0) params.set("e", String(errorCount));
  if (warningCount > 0) params.set("w", String(warningCount));
  if (affectedFileCount > 0) params.set("f", String(affectedFileCount));
  return `${SHARE_BASE_URL}?${params.toString()}`;
};

interface AppProps {
  rootDirectory: string;
  initialMode: "dashboard" | "review";
  startWatching: boolean;
}

export const App = ({ rootDirectory, initialMode, startWatching }: AppProps) => {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, rootDirectory, buildInitialState);
  const isScanInFlightRef = useRef(false);
  const watcherHandleRef = useRef<WatcherHandle | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const triggerScan = useCallback(() => {
    if (isScanInFlightRef.current) return;
    isScanInFlightRef.current = true;
    dispatch({ type: "scan-started" });
    void runScanWithListener({
      directory: rootDirectory,
      options: { lint: true, deadCode: true, offline: false },
      listener: (controllerEvent) => {
        if (controllerEvent.type === "event" && controllerEvent.event) {
          dispatch({ type: "scan-event", event: controllerEvent.event });
        }
        if (controllerEvent.type === "failed" && controllerEvent.error) {
          dispatch({ type: "scan-failed", message: controllerEvent.error.message });
          isScanInFlightRef.current = false;
        }
        if (controllerEvent.type === "finished") {
          isScanInFlightRef.current = false;
        }
      },
    });
  }, [rootDirectory]);

  useEffect(() => {
    dispatch({ type: "set-view", viewMode: initialMode });
  }, [initialMode]);

  useEffect(() => {
    triggerScan();
  }, [triggerScan]);

  useEffect(() => {
    if (!startWatching) return undefined;
    dispatch({ type: "set-watching", watching: true });
    const handle = startWatcher(rootDirectory, () => {
      if (!isScanInFlightRef.current) triggerScan();
    });
    watcherHandleRef.current = handle;
    return () => {
      void handle.close();
      watcherHandleRef.current = null;
    };
  }, [rootDirectory, startWatching, triggerScan]);

  useEffect(() => {
    if (state.scanStatus !== "complete" || state.diagnostics.length === 0) return;
    try {
      const outputPath = writeDiagnosticsDirectory(state.diagnostics);
      const projectName = state.project?.projectName ?? "project";
      const shareUrl = buildShareUrl(state.diagnostics, state.score?.score ?? null, projectName);
      dispatch({ type: "set-diagnostics-path", path: outputPath, shareUrl });
    } catch {
      // non-fatal — don't block the UI if temp write fails
    }
  }, [state.scanStatus, state.scanCount]);

  useEffect(() => {
    if (state.exitRequested) {
      void watcherHandleRef.current?.close();
      exit();
    }
  }, [state.exitRequested, exit]);

  const toggleWatch = useCallback(() => {
    if (watcherHandleRef.current) {
      void watcherHandleRef.current.close();
      watcherHandleRef.current = null;
      dispatch({ type: "set-watching", watching: false });
      return;
    }
    const handle = startWatcher(rootDirectory, () => {
      if (!isScanInFlightRef.current) triggerScan();
    });
    watcherHandleRef.current = handle;
    dispatch({ type: "set-watching", watching: true });
  }, [rootDirectory, triggerScan]);

  useInput((rawInput, key) => {
    const currentState = stateRef.current;
    if (currentState.isFilterActive) {
      if (key.escape) {
        dispatch({ type: "set-filter", text: "" });
        dispatch({ type: "toggle-filter", active: false });
        return;
      }
      if (key.return) {
        dispatch({ type: "toggle-filter", active: false });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: "set-filter", text: currentState.filterText.slice(0, -1) });
        return;
      }
      if (rawInput && !key.ctrl && !key.meta && rawInput.length === 1) {
        dispatch({ type: "set-filter", text: currentState.filterText + rawInput });
      }
      return;
    }
    if (key.ctrl && rawInput === "c") {
      dispatch({ type: "request-exit" });
      return;
    }
    if (rawInput === "q") {
      dispatch({ type: "request-exit" });
      return;
    }
    if (rawInput === "?") {
      dispatch({ type: "toggle-help" });
      return;
    }
    if (rawInput === "r") {
      triggerScan();
      return;
    }
    if (rawInput === "w") {
      toggleWatch();
      return;
    }
    if (rawInput === "d") {
      dispatch({ type: "set-view", viewMode: "review" });
      return;
    }
    if (rawInput === "v") {
      dispatch({ type: "set-view", viewMode: "dashboard" });
      return;
    }
    if (key.escape) {
      dispatch({ type: "set-view", viewMode: "dashboard" });
      return;
    }
    if (currentState.viewMode === "review") {
      if (key.upArrow || rawInput === "k") {
        dispatch({ type: "navigate-rule", delta: -1 });
        return;
      }
      if (key.downArrow || rawInput === "j") {
        dispatch({ type: "navigate-rule", delta: 1 });
        return;
      }
      if (key.leftArrow || rawInput === "h") {
        dispatch({ type: "navigate-site", delta: -1 });
        return;
      }
      if (key.rightArrow || rawInput === "l") {
        dispatch({ type: "navigate-site", delta: 1 });
        return;
      }
      if (rawInput === "/") {
        dispatch({ type: "toggle-filter", active: true });
        return;
      }
    }
  });

  const { columns, rows } = useTerminalSize();

  return (
    <Box flexDirection="column">
      <Header
        rootDirectory={state.rootDirectory}
        project={state.project}
        isWatching={state.isWatching}
        terminalColumns={columns}
      />
      {state.helpVisible ? (
        <HelpOverlay />
      ) : state.viewMode === "review" ? (
        <ReviewView state={state} terminalColumns={columns} terminalRows={rows} />
      ) : (
        <DashboardView state={state} terminalColumns={columns} />
      )}
      {state.isFilterActive ? <FilterInput value={state.filterText} /> : null}
      <StatusBar
        viewMode={state.viewMode}
        isWatching={state.isWatching}
        isFilterActive={state.isFilterActive}
      />
    </Box>
  );
};

export type { AppAction };
