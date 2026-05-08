import { describe, expect, it } from "vite-plus/test";
import type {
  Diagnostic,
  ProjectInfo,
  ScanCompleteEvent,
  ScanProjectDetectedEvent,
  ScanScoreResolvedEvent,
  ScanStepStartEvent,
  ScanStepFinishEvent,
} from "../../src/types.js";
import { appReducer, buildInitialState } from "../../src/tui/store.js";
import type { AppState } from "../../src/tui/types.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample",
  reactVersion: "19.2.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 12,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/src/App.tsx",
  plugin: "react-doctor",
  rule: "no-fetch-in-effect",
  severity: "error",
  message: "Avoid fetch inside useEffect.",
  help: "Use a data-fetching library.",
  line: 14,
  column: 1,
  category: "state-effects",
  ...overrides,
});

const advance = (initialState: AppState, ...events: Parameters<typeof appReducer>[1][]): AppState =>
  events.reduce((accumulatedState, event) => appReducer(accumulatedState, event), initialState);

describe("appReducer", () => {
  it("rebuilds steps and clears error on scan-started", () => {
    const startingState = buildInitialState("/repo");
    const errored: AppState = { ...startingState, scanStatus: "error", errorMessage: "boom" };
    const nextState = appReducer(errored, { type: "scan-started" });
    expect(nextState.scanStatus).toBe("scanning");
    expect(nextState.errorMessage).toBeNull();
    expect(nextState.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("transitions step state via scan events", () => {
    const startingState = buildInitialState("/repo");
    const projectDetectedEvent: ScanProjectDetectedEvent = {
      type: "project-detected",
      project: SAMPLE_PROJECT,
      isDiffMode: false,
      scanFileCount: 12,
      hasUserConfig: false,
    };
    const stepStartEvent: ScanStepStartEvent = {
      type: "step-start",
      stepId: "lint",
      message: "Running lint checks...",
    };
    const stepFinishEvent: ScanStepFinishEvent = {
      type: "step-finish",
      stepId: "lint",
      status: "succeed",
      message: "Lint complete.",
      detail: "3 diagnostics",
    };
    const finalState = advance(
      startingState,
      { type: "scan-event", event: projectDetectedEvent },
      { type: "scan-event", event: stepStartEvent },
      { type: "scan-event", event: stepFinishEvent },
    );
    expect(finalState.project?.projectName).toBe("sample");
    const lintStep = finalState.steps.find((step) => step.id === "lint");
    expect(lintStep?.status).toBe("succeed");
    expect(lintStep?.detail).toBe("3 diagnostics");
  });

  it("populates score, diagnostics and groups on completion", () => {
    const startingState = buildInitialState("/repo");
    const diagnostics = [
      buildDiagnostic({ rule: "no-fetch-in-effect", line: 10 }),
      buildDiagnostic({ rule: "no-fetch-in-effect", line: 22 }),
      buildDiagnostic({ rule: "no-array-index-as-key", severity: "warning", line: 5 }),
    ];
    const scoreResolvedEvent: ScanScoreResolvedEvent = {
      type: "score-resolved",
      score: { score: 78, label: "Great" },
      isOffline: true,
    };
    const completeEvent: ScanCompleteEvent = {
      type: "complete",
      result: {
        diagnostics,
        score: { score: 78, label: "Great" },
        skippedChecks: [],
        project: SAMPLE_PROJECT,
        elapsedMilliseconds: 1234,
      },
    };
    const finalState = advance(
      startingState,
      { type: "scan-event", event: scoreResolvedEvent },
      { type: "scan-event", event: completeEvent },
    );
    expect(finalState.scanStatus).toBe("complete");
    expect(finalState.diagnostics).toHaveLength(3);
    expect(finalState.groupedRules[0].severity).toBe("error");
    expect(finalState.score?.score).toBe(78);
    expect(finalState.scoreHistory).toHaveLength(1);
  });

  it("clamps navigation indices to the available range", () => {
    const startingState: AppState = {
      ...buildInitialState("/repo"),
      groupedRules: [
        {
          ruleKey: "react-doctor/no-fetch-in-effect",
          plugin: "react-doctor",
          rule: "no-fetch-in-effect",
          severity: "error",
          category: "state-effects",
          message: "Avoid fetch inside useEffect.",
          help: "",
          diagnostics: [buildDiagnostic(), buildDiagnostic({ line: 22 })],
        },
      ],
      matchedDiagnostics: [],
    };
    const movedDown = appReducer(startingState, { type: "navigate-rule", delta: 5 });
    expect(movedDown.selectedRuleIndex).toBe(0);
    const movedSiteRight = appReducer(startingState, { type: "navigate-site", delta: 5 });
    expect(movedSiteRight.selectedSiteIndex).toBe(1);
    const movedSiteLeft = appReducer(movedSiteRight, { type: "navigate-site", delta: -10 });
    expect(movedSiteLeft.selectedSiteIndex).toBe(0);
  });
});
