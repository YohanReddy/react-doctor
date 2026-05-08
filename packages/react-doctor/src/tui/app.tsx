import { Box, useApp, useInput } from "ink";
import path from "node:path";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { discoverReactSubprojects, listWorkspacePackages } from "../utils/discover-project.js";
import { TOAST_AUTO_DISMISS_MS } from "./constants.js";
import { DashboardView } from "./components/dashboard-view.js";
import { SearchInput } from "./components/search-input.js";
import { Header } from "./components/header.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { ProjectPicker } from "./components/project-picker.js";
import { ReviewView } from "./components/review-view.js";
import { StatusBar } from "./components/status-bar.js";
import { Toast } from "./components/toast.js";
import { runScanWithListener } from "./scan-controller.js";
import { appReducer, buildInitialState } from "./store.js";
import type { AppAction, GroupedRule } from "./types.js";
import { buildShareUrl } from "./utils/build-share-url.js";
import { copyToClipboard } from "./utils/copy-to-clipboard.js";
import { formatIssueAsMarkdown } from "./utils/format-issue-as-markdown.js";
import { useTerminalSize } from "./utils/use-terminal-size.js";
import { writeDiagnosticsToTempDir } from "./utils/write-diagnostics-to-temp-dir.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

interface AppProps {
  rootDirectory: string;
  initialMode: "dashboard" | "review";
  startWatching: boolean;
  preselectedProject?: string;
}

const findPackageByNameOrBasename = (
  packages: ReturnType<typeof listWorkspacePackages>,
  query: string,
): string | null => {
  const matched = packages.find(
    (workspacePackage) =>
      workspacePackage.name === query || path.basename(workspacePackage.directory) === query,
  );
  return matched?.directory ?? null;
};

export const App = ({
  rootDirectory,
  initialMode,
  startWatching,
  preselectedProject,
}: AppProps) => {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(appReducer, rootDirectory, buildInitialState);
  const isScanInFlightRef = useRef(false);
  const watcherHandleRef = useRef<WatcherHandle | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const discoveredPackages = useMemo(() => {
    const workspacePackages = listWorkspacePackages(rootDirectory);
    if (workspacePackages.length > 0) return workspacePackages;
    return discoverReactSubprojects(rootDirectory);
  }, [rootDirectory]);

  useEffect(() => {
    dispatch({ type: "set-workspace-packages", packages: discoveredPackages });
    if (preselectedProject) {
      const matchedDirectory = findPackageByNameOrBasename(discoveredPackages, preselectedProject);
      if (matchedDirectory) {
        dispatch({ type: "select-workspace", directory: matchedDirectory });
        return;
      }
    }
    if (discoveredPackages.length === 0) {
      dispatch({ type: "select-workspace", directory: rootDirectory });
      return;
    }
    if (discoveredPackages.length === 1) {
      dispatch({ type: "select-workspace", directory: discoveredPackages[0].directory });
    }
  }, [discoveredPackages, preselectedProject, rootDirectory]);

  const triggerScan = useCallback((directoryToScan: string) => {
    if (isScanInFlightRef.current) return;
    isScanInFlightRef.current = true;
    dispatch({ type: "scan-started" });
    void runScanWithListener({
      directory: directoryToScan,
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
  }, []);

  useEffect(() => {
    dispatch({ type: "set-view", viewMode: initialMode });
  }, [initialMode]);

  useEffect(() => {
    if (state.selectedDirectory && state.scanCount === 0 && state.scanStatus === "idle") {
      triggerScan(state.selectedDirectory);
    }
  }, [state.selectedDirectory, state.scanCount, state.scanStatus, triggerScan]);

  useEffect(() => {
    if (!startWatching || !state.selectedDirectory) return undefined;
    dispatch({ type: "set-watching", watching: true });
    const targetDirectory = state.selectedDirectory;
    const handle = startWatcher(targetDirectory, () => {
      if (!isScanInFlightRef.current) triggerScan(targetDirectory);
    });
    watcherHandleRef.current = handle;
    return () => {
      void handle.close();
      watcherHandleRef.current = null;
    };
  }, [state.selectedDirectory, startWatching, triggerScan]);

  useEffect(() => {
    if (state.exitRequested) {
      void watcherHandleRef.current?.close();
      exit();
    }
  }, [state.exitRequested, exit]);

  const toggleWatch = useCallback(() => {
    const targetDirectory = stateRef.current.selectedDirectory;
    if (!targetDirectory) return;
    if (watcherHandleRef.current) {
      void watcherHandleRef.current.close();
      watcherHandleRef.current = null;
      dispatch({ type: "set-watching", watching: false });
      return;
    }
    const handle = startWatcher(targetDirectory, () => {
      if (!isScanInFlightRef.current) triggerScan(targetDirectory);
    });
    watcherHandleRef.current = handle;
    dispatch({ type: "set-watching", watching: true });
  }, [triggerScan]);

  const pickRuleForCopy = useCallback((appState: typeof state): GroupedRule | undefined => {
    if (appState.viewMode === "review") {
      return appState.groupedRules[appState.selectedRuleIndex];
    }
    return appState.groupedRules[0];
  }, []);

  const handleCopy = useCallback(async () => {
    const currentState = stateRef.current;
    const rule = pickRuleForCopy(currentState);
    if (!rule) {
      dispatch({ type: "set-toast", message: "Nothing to copy yet.", tone: "info" });
      return;
    }
    const markdown = formatIssueAsMarkdown(rule, currentState.rootDirectory);
    const result = await copyToClipboard(markdown);
    if (result.ok) {
      dispatch({
        type: "set-toast",
        message: `Copied diagnostic to clipboard (${result.via}).`,
        tone: "success",
      });
      return;
    }
    if (result.fallbackPath) {
      dispatch({
        type: "set-toast",
        message: `No clipboard found — wrote ${result.fallbackPath}.`,
        tone: "info",
      });
      return;
    }
    dispatch({
      type: "set-toast",
      message: `Copy failed: ${result.error ?? "unknown error"}.`,
      tone: "error",
    });
  }, [pickRuleForCopy]);

  useInput((rawInput, key) => {
    const currentState = stateRef.current;

    // Universal quit shortcut.
    if (key.ctrl && rawInput === "c") {
      dispatch({ type: "request-exit" });
      return;
    }

    // Help overlay: only escape, ?, q, and ctrl-c work; everything else is
    // swallowed so the user can't accidentally trigger an action while reading.
    if (currentState.helpVisible) {
      if (rawInput === "q") {
        dispatch({ type: "request-exit" });
        return;
      }
      if (key.escape || rawInput === "?") {
        dispatch({ type: "toggle-help" });
        return;
      }
      return;
    }

    // Project picker mode: only nav and enter / quit are meaningful.
    if (!currentState.selectedDirectory && currentState.workspacePackages.length > 1) {
      if (rawInput === "q") {
        dispatch({ type: "request-exit" });
        return;
      }
      if (key.upArrow || rawInput === "k") {
        dispatch({ type: "navigate-workspace", delta: -1 });
        return;
      }
      if (key.downArrow || rawInput === "j") {
        dispatch({ type: "navigate-workspace", delta: 1 });
        return;
      }
      if (key.return) {
        const chosen = currentState.workspacePackages[currentState.workspaceCursor];
        if (chosen) dispatch({ type: "select-workspace", directory: chosen.directory });
        return;
      }
      return;
    }

    if (currentState.isSearchActive) {
      if (key.escape) {
        dispatch({ type: "set-search", text: "" });
        dispatch({ type: "toggle-search", active: false });
        return;
      }
      if (key.return) {
        dispatch({ type: "toggle-search", active: false });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: "set-search", text: currentState.searchText.slice(0, -1) });
        return;
      }
      if (rawInput && !key.ctrl && !key.meta && rawInput.length === 1) {
        dispatch({ type: "set-search", text: currentState.searchText + rawInput });
      }
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
      if (currentState.selectedDirectory) triggerScan(currentState.selectedDirectory);
      return;
    }
    if (rawInput === "w") {
      toggleWatch();
      return;
    }
    if (rawInput === "c") {
      void handleCopy();
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
        dispatch({ type: "toggle-search", active: true });
        return;
      }
    }
  });

  useEffect(() => {
    if (!state.toastMessage) return undefined;
    const dismissTimer = setTimeout(() => {
      dispatch({ type: "set-toast", message: null, tone: state.toastTone });
    }, TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(dismissTimer);
  }, [state.toastNonce, state.toastMessage, state.toastTone]);

  // Persist diagnostics to a temp directory and refresh the share URL once
  // per scan completion so the dashboard can surface both. Re-runs only when
  // the scan count actually advances, never on cosmetic state changes.
  const lastArtifactScanRef = useRef(0);
  useEffect(() => {
    if (state.scanStatus !== "complete") return;
    if (state.scanCount <= lastArtifactScanRef.current) return;
    lastArtifactScanRef.current = state.scanCount;
    if (state.diagnostics.length === 0) {
      dispatch({
        type: "set-scan-artifacts",
        diagnosticsDirectory: null,
        shareUrl: null,
      });
      return;
    }
    try {
      const writeResult = writeDiagnosticsToTempDir(state.diagnostics);
      const projectName = state.project?.projectName ?? path.basename(state.rootDirectory);
      const shareUrl = buildShareUrl(state.diagnostics, state.score, projectName);
      dispatch({
        type: "set-scan-artifacts",
        diagnosticsDirectory: writeResult.outputDirectory,
        shareUrl,
      });
    } catch (artifactError) {
      dispatch({
        type: "set-scan-artifacts",
        diagnosticsDirectory: null,
        shareUrl: null,
      });
      dispatch({
        type: "set-toast",
        message: `Could not write diagnostics: ${(artifactError as Error)?.message ?? "unknown error"}`,
        tone: "error",
      });
    }
  }, [
    state.scanStatus,
    state.scanCount,
    state.diagnostics,
    state.project,
    state.rootDirectory,
    state.score,
  ]);

  const { columns, rows } = useTerminalSize();

  const headerDirectory = state.selectedDirectory ?? state.rootDirectory;
  const isPickingProject = !state.selectedDirectory && state.workspacePackages.length > 1;

  return (
    <Box flexDirection="column">
      <Header rootDirectory={headerDirectory} terminalColumns={columns} />
      {isPickingProject ? (
        <ProjectPicker
          rootDirectory={state.rootDirectory}
          packages={state.workspacePackages}
          cursorIndex={state.workspaceCursor}
        />
      ) : state.helpVisible ? (
        <HelpOverlay />
      ) : state.viewMode === "review" ? (
        <ReviewView state={state} terminalColumns={columns} terminalRows={rows} />
      ) : (
        <DashboardView state={state} terminalColumns={columns} />
      )}
      {state.isSearchActive ? <SearchInput value={state.searchText} /> : null}
      {state.toastMessage ? <Toast message={state.toastMessage} tone={state.toastTone} /> : null}
      {!isPickingProject ? (
        <StatusBar
          viewMode={state.viewMode}
          isWatching={state.isWatching}
          isSearchActive={state.isSearchActive}
        />
      ) : null}
    </Box>
  );
};

export type { AppAction };
