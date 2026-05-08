import type {
  Diagnostic,
  ProjectInfo,
  ScanEvent,
  ScanResult,
  ScanStepId,
  ScoreResult,
  WorkspacePackage,
} from "../types.js";

export type DoctorMood = "scanning" | "great" | "ok" | "bad" | "neutral" | "error";

export type ScanStatus = "idle" | "scanning" | "complete" | "error";

export type ViewMode = "dashboard" | "review";

export type StepStatus = "pending" | "running" | "succeed" | "fail" | "skip";

export interface StepState {
  id: ScanStepId;
  message: string;
  status: StepStatus;
  detail?: string;
}

export interface ScoreHistoryPoint {
  score: number;
  diagnosticCount: number;
  timestamp: number;
}

export interface AppState {
  rootDirectory: string;
  selectedDirectory: string | null;
  workspacePackages: WorkspacePackage[];
  workspaceCursor: number;
  viewMode: ViewMode;
  scanStatus: ScanStatus;
  isWatching: boolean;
  steps: StepState[];
  project: ProjectInfo | null;
  diagnostics: Diagnostic[];
  matchedDiagnostics: Diagnostic[];
  groupedRules: GroupedRule[];
  selectedRuleIndex: number;
  selectedSiteIndex: number;
  searchText: string;
  isSearchActive: boolean;
  score: ScoreResult | null;
  previousScore: ScoreResult | null;
  scoreHistory: ScoreHistoryPoint[];
  isOffline: boolean;
  scanCount: number;
  lastScanStartedAt: number | null;
  lastScanFinishedAt: number | null;
  lastScanElapsedMs: number | null;
  errorMessage: string | null;
  exitRequested: boolean;
  helpVisible: boolean;
  toastMessage: string | null;
  toastTone: "success" | "info" | "error";
  toastNonce: number;
  diagnosticsDirectory: string | null;
  shareUrl: string | null;
}

export interface GroupedRule {
  ruleKey: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  category: string;
  message: string;
  help: string;
  diagnostics: Diagnostic[];
}

export type AppAction =
  | { type: "scan-event"; event: ScanEvent }
  | { type: "scan-started" }
  | { type: "scan-finished"; result: ScanResult }
  | { type: "scan-failed"; message: string }
  | { type: "set-watching"; watching: boolean }
  | { type: "set-view"; viewMode: ViewMode }
  | { type: "navigate-rule"; delta: number }
  | { type: "navigate-site"; delta: number }
  | { type: "set-search"; text: string }
  | { type: "toggle-search"; active: boolean }
  | { type: "toggle-help" }
  | { type: "set-workspace-packages"; packages: WorkspacePackage[] }
  | { type: "navigate-workspace"; delta: number }
  | { type: "select-workspace"; directory: string }
  | { type: "set-toast"; message: string | null; tone?: "success" | "info" | "error" }
  | {
      type: "set-scan-artifacts";
      diagnosticsDirectory: string | null;
      shareUrl: string | null;
    }
  | { type: "request-exit" };

export interface CategoryBreakdown {
  category: string;
  errorCount: number;
  warningCount: number;
  total: number;
}
