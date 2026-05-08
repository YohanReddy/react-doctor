import type {
  Diagnostic,
  ProjectInfo,
  ScanEvent,
  ScanResult,
  ScanStepId,
  ScoreResult,
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
  viewMode: ViewMode;
  scanStatus: ScanStatus;
  isWatching: boolean;
  steps: StepState[];
  project: ProjectInfo | null;
  diagnostics: Diagnostic[];
  filteredDiagnostics: Diagnostic[];
  groupedRules: GroupedRule[];
  selectedRuleIndex: number;
  selectedSiteIndex: number;
  filterText: string;
  isFilterActive: boolean;
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
  | { type: "set-filter"; text: string }
  | { type: "toggle-filter"; active: boolean }
  | { type: "toggle-help" }
  | { type: "request-exit" };

export interface CategoryBreakdown {
  category: string;
  errorCount: number;
  warningCount: number;
  total: number;
}
