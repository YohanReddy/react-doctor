import { describe, expect, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { buildInitialState } from "../../src/tui/store.js";
import type { AppState, GroupedRule } from "../../src/tui/types.js";
import type { Diagnostic, ProjectInfo } from "../../src/types.js";
import { stripAnsi } from "./strip-ansi.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "demo",
  reactVersion: "19.2.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 30,
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

const stateWithDiagnostics = (overrides: Partial<AppState> = {}): AppState => {
  const baseState = buildInitialState("/repo");
  const fetchRule: GroupedRule = {
    ruleKey: "react-doctor/no-fetch-in-effect",
    plugin: "react-doctor",
    rule: "no-fetch-in-effect",
    severity: "error",
    category: "state-effects",
    message: "Avoid fetch inside useEffect.",
    help: "Use a data-fetching library.",
    diagnostics: [buildDiagnostic(), buildDiagnostic({ line: 22 })],
  };
  const arrayRule: GroupedRule = {
    ruleKey: "react-doctor/no-array-index-as-key",
    plugin: "react-doctor",
    rule: "no-array-index-as-key",
    severity: "warning",
    category: "performance",
    message: "Avoid using array index as a React key.",
    help: "",
    diagnostics: Array.from({ length: 5 }, () =>
      buildDiagnostic({ severity: "warning", category: "performance" }),
    ),
  };
  return {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 78, label: "Great" },
    diagnostics: [...fetchRule.diagnostics, ...arrayRule.diagnostics],
    matchedDiagnostics: [...fetchRule.diagnostics, ...arrayRule.diagnostics],
    groupedRules: [fetchRule, arrayRule],
    scanCount: 1,
    lastScanElapsedMs: 1500,
    steps: baseState.steps.map((step) => ({ ...step, status: "succeed" as const })),
    ...overrides,
  };
};

describe("DashboardView", () => {
  it("focuses on the worst rule with its message, help, and source location after a scan completes", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("react-doctor/no-fetch-in-effect");
    expect(frame).toContain("2 sites");
    expect(frame).toContain("Avoid fetch inside useEffect.");
    expect(frame).toContain("Use a data-fetching library.");
    expect(frame).toContain("src/App.tsx:14");
    expect(frame).toContain("+ 1 more site");
  });

  it("lists remaining rules compactly without repeating the focused rule", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("no-array-index-as-key");
    expect(frame).toContain("5 sites");
    const fetchOccurrences = frame.split("no-fetch-in-effect").length - 1;
    expect(fetchOccurrences).toBe(1);
  });

  it("hides the live progress checklist after a scan completes (replaced by the focused issue)", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("Detecting framework");
    expect(frame).not.toContain("Resolving Node runtime");
    expect(frame).not.toContain("Calculating score");
  });

  it("shows a single inline progress line during the very first scan (before any results)", () => {
    const initial = buildInitialState("/repo");
    const scanningState: AppState = {
      ...initial,
      project: SAMPLE_PROJECT,
      scanStatus: "scanning",
      scanCount: 0,
      steps: initial.steps.map((step, stepIndex) =>
        stepIndex < 2
          ? { ...step, status: "succeed" }
          : stepIndex === 2
            ? { ...step, status: "running" }
            : step,
      ),
    };
    const { lastFrame } = render(<DashboardView state={scanningState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Detecting language");
    expect(frame).toContain("(2/");
    expect(frame).not.toContain("Resolving Node runtime");
    expect(frame).not.toContain("no-fetch-in-effect");
  });

  it("keeps the focused issue visible during a re-scan and appends a rescanning indicator to the footer", () => {
    const rescanningState = stateWithDiagnostics({ scanStatus: "scanning" });
    const { lastFrame } = render(<DashboardView state={rescanningState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("react-doctor/no-fetch-in-effect");
    expect(frame).toContain("rescanning");
  });

  it("shows a friendly empty state when a scan completes with zero issues", () => {
    const cleanState: AppState = {
      ...stateWithDiagnostics(),
      diagnostics: [],
      matchedDiagnostics: [],
      groupedRules: [],
    };
    const { lastFrame } = render(<DashboardView state={cleanState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("No issues detected");
  });

  it("renders a prominent error banner when the scan fails", () => {
    const erroredState = stateWithDiagnostics({
      scanStatus: "error",
      errorMessage: "oxlint native binding not found",
    });
    const { lastFrame } = render(<DashboardView state={erroredState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Scan failed");
    expect(frame).toContain("oxlint native binding not found");
    expect(frame).not.toContain("no-fetch-in-effect");
  });

  it("renders without throwing at every common terminal width", () => {
    for (const columnsForBreakpoint of [40, 60, 80, 100, 120, 160, 200]) {
      const { lastFrame, unmount } = render(
        <DashboardView state={stateWithDiagnostics()} terminalColumns={columnsForBreakpoint} />,
      );
      expect(typeof lastFrame()).toBe("string");
      unmount();
    }
  });

  it("shows a 'By category' overview chart above the focused issue when 2+ categories exist", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    const categoryHeaderIndex = frame.indexOf("By category");
    const focusedRuleIndex = frame.indexOf("react-doctor/no-fetch-in-effect");
    expect(categoryHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(focusedRuleIndex).toBeGreaterThan(categoryHeaderIndex);
  });

  it("hides the category overview chart when there is only one category", () => {
    const singleCategoryState = stateWithDiagnostics();
    singleCategoryState.diagnostics = singleCategoryState.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      category: "state-effects",
    }));
    const { lastFrame } = render(
      <DashboardView state={singleCategoryState} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("By category");
  });

  it("hides the category overview chart during the very first scan", () => {
    const initial = buildInitialState("/repo");
    const scanningState: AppState = {
      ...initial,
      project: SAMPLE_PROJECT,
      scanStatus: "scanning",
      scanCount: 0,
      diagnostics: [],
    };
    const { lastFrame } = render(<DashboardView state={scanningState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("By category");
  });
});
