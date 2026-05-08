import type { ScanEvent } from "../types.js";
import { RECENT_SCORE_HISTORY_LIMIT } from "./constants.js";
import { searchDiagnostics } from "./utils/search-diagnostics.js";
import { groupDiagnosticsByRule } from "./utils/group-diagnostics.js";
import type { AppAction, AppState, ScoreHistoryPoint, StepState } from "./types.js";

const INITIAL_STEPS: StepState[] = [
  { id: "framework", message: "Detecting framework", status: "pending" },
  { id: "react-version", message: "Detecting React version", status: "pending" },
  { id: "language", message: "Detecting language", status: "pending" },
  { id: "react-compiler", message: "Detecting React Compiler", status: "pending" },
  { id: "files", message: "Counting source files", status: "pending" },
  { id: "config", message: "Loading config", status: "pending" },
  { id: "node-resolve", message: "Resolving Node runtime", status: "pending" },
  { id: "lint", message: "Running lint checks", status: "pending" },
  { id: "dead-code", message: "Detecting dead code", status: "pending" },
  { id: "score", message: "Calculating score", status: "pending" },
];

const cloneSteps = (): StepState[] => INITIAL_STEPS.map((step) => ({ ...step }));

export const buildInitialState = (rootDirectory: string): AppState => ({
  rootDirectory,
  selectedDirectory: null,
  workspacePackages: [],
  workspaceCursor: 0,
  viewMode: "dashboard",
  scanStatus: "idle",
  isWatching: false,
  steps: cloneSteps(),
  project: null,
  diagnostics: [],
  matchedDiagnostics: [],
  groupedRules: [],
  selectedRuleIndex: 0,
  selectedSiteIndex: 0,
  searchText: "",
  isSearchActive: false,
  score: null,
  previousScore: null,
  scoreHistory: [],
  isOffline: false,
  scanCount: 0,
  lastScanStartedAt: null,
  lastScanFinishedAt: null,
  lastScanElapsedMs: null,
  errorMessage: null,
  exitRequested: false,
  helpVisible: false,
  toastMessage: null,
  toastTone: "info",
  toastNonce: 0,
  diagnosticsDirectory: null,
  shareUrl: null,
});

const updateStep = (
  steps: StepState[],
  stepId: StepState["id"],
  changes: Partial<StepState>,
): StepState[] =>
  steps.map((existingStep) =>
    existingStep.id === stepId ? { ...existingStep, ...changes } : existingStep,
  );

const recomputeRules = (state: AppState): AppState => {
  const matched = searchDiagnostics(state.diagnostics, state.searchText);
  const grouped = groupDiagnosticsByRule(matched);
  const safeRuleIndex = Math.min(state.selectedRuleIndex, Math.max(0, grouped.length - 1));
  const ruleAtIndex = grouped[safeRuleIndex];
  const safeSiteIndex = ruleAtIndex
    ? Math.min(state.selectedSiteIndex, Math.max(0, ruleAtIndex.diagnostics.length - 1))
    : 0;
  return {
    ...state,
    matchedDiagnostics: matched,
    groupedRules: grouped,
    selectedRuleIndex: safeRuleIndex,
    selectedSiteIndex: safeSiteIndex,
  };
};

const handleScanEvent = (state: AppState, event: ScanEvent): AppState => {
  switch (event.type) {
    case "project-detected":
      return {
        ...state,
        project: event.project,
        scanStatus: "scanning",
        errorMessage: null,
      };
    case "step-start":
      return {
        ...state,
        steps: updateStep(state.steps, event.stepId, {
          status: "running",
          message: event.message,
          detail: undefined,
        }),
      };
    case "step-finish":
      return {
        ...state,
        steps: updateStep(state.steps, event.stepId, {
          status: event.status,
          message: event.message,
          detail: event.detail,
        }),
      };
    case "score-resolved":
      return {
        ...state,
        score: event.score,
        isOffline: event.isOffline,
      };
    case "warn":
      return state;
    case "complete": {
      const previousHistoryPoint: ScoreHistoryPoint | null =
        event.result.score !== null
          ? {
              score: event.result.score.score,
              diagnosticCount: event.result.diagnostics.length,
              timestamp: Date.now(),
            }
          : null;
      const updatedHistory = previousHistoryPoint
        ? [...state.scoreHistory, previousHistoryPoint].slice(-RECENT_SCORE_HISTORY_LIMIT)
        : state.scoreHistory;
      const completedState: AppState = {
        ...state,
        previousScore: state.score,
        score: event.result.score,
        diagnostics: event.result.diagnostics,
        scanStatus: "complete",
        lastScanFinishedAt: Date.now(),
        lastScanElapsedMs: event.result.elapsedMilliseconds,
        scanCount: state.scanCount + 1,
        scoreHistory: updatedHistory,
      };
      return recomputeRules(completedState);
    }
    case "failed":
      return {
        ...state,
        scanStatus: "error",
        errorMessage: event.error.message,
      };
    default:
      return state;
  }
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "scan-event":
      return handleScanEvent(state, action.event);
    case "scan-started":
      return {
        ...state,
        scanStatus: "scanning",
        steps: cloneSteps(),
        errorMessage: null,
        lastScanStartedAt: Date.now(),
      };
    case "scan-finished":
      return state;
    case "scan-failed":
      return { ...state, scanStatus: "error", errorMessage: action.message };
    case "set-watching":
      return { ...state, isWatching: action.watching };
    case "set-view":
      return { ...state, viewMode: action.viewMode };
    case "navigate-rule": {
      if (state.groupedRules.length === 0) return state;
      const nextIndex = clamp(
        state.selectedRuleIndex + action.delta,
        0,
        state.groupedRules.length - 1,
      );
      if (nextIndex === state.selectedRuleIndex) return state;
      return { ...state, selectedRuleIndex: nextIndex, selectedSiteIndex: 0 };
    }
    case "navigate-site": {
      const currentRule = state.groupedRules[state.selectedRuleIndex];
      if (!currentRule || currentRule.diagnostics.length === 0) return state;
      const nextIndex = clamp(
        state.selectedSiteIndex + action.delta,
        0,
        currentRule.diagnostics.length - 1,
      );
      if (nextIndex === state.selectedSiteIndex) return state;
      return { ...state, selectedSiteIndex: nextIndex };
    }
    case "set-search":
      return recomputeRules({ ...state, searchText: action.text });
    case "toggle-search":
      return { ...state, isSearchActive: action.active };
    case "toggle-help":
      return { ...state, helpVisible: !state.helpVisible };
    case "set-workspace-packages":
      return {
        ...state,
        workspacePackages: action.packages,
        workspaceCursor: 0,
      };
    case "navigate-workspace": {
      if (state.workspacePackages.length === 0) return state;
      const nextCursor = clamp(
        state.workspaceCursor + action.delta,
        0,
        state.workspacePackages.length - 1,
      );
      if (nextCursor === state.workspaceCursor) return state;
      return { ...state, workspaceCursor: nextCursor };
    }
    case "select-workspace":
      return { ...state, selectedDirectory: action.directory };
    case "set-toast":
      return {
        ...state,
        toastMessage: action.message,
        toastTone: action.tone ?? "info",
        toastNonce: state.toastNonce + 1,
      };
    case "set-scan-artifacts":
      return {
        ...state,
        diagnosticsDirectory: action.diagnosticsDirectory,
        shareUrl: action.shareUrl,
      };
    case "request-exit":
      return { ...state, exitRequested: true };
    default:
      return state;
  }
};
