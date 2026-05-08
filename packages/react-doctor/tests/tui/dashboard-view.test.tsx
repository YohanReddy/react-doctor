import { describe, expect, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { buildInitialState } from "../../src/tui/store.js";
import type { AppState, GroupedRule } from "../../src/tui/types.js";
import type { Diagnostic, ProjectInfo } from "../../src/types.js";

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

import { stripAnsi } from "./strip-ansi.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/src/App.tsx",
  plugin: "react-doctor",
  rule: "no-fetch-in-effect",
  severity: "error",
  message: "Avoid fetch inside useEffect.",
  help: "",
  line: 14,
  column: 1,
  category: "state-effects",
  ...overrides,
});

const stateWithDiagnostics = (overrides: Partial<AppState> = {}): AppState => {
  const baseState = buildInitialState("/repo");
  const rule: GroupedRule = {
    ruleKey: "react-doctor/no-fetch-in-effect",
    plugin: "react-doctor",
    rule: "no-fetch-in-effect",
    severity: "error",
    category: "state-effects",
    message: "Avoid fetch inside useEffect.",
    help: "Use a data-fetching library.",
    diagnostics: [buildDiagnostic(), buildDiagnostic({ line: 22 })],
  };
  return {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 78, label: "Great" },
    diagnostics: rule.diagnostics,
    filteredDiagnostics: rule.diagnostics,
    groupedRules: [rule],
    scanCount: 1,
    lastScanElapsedMs: 1500,
    steps: baseState.steps.map((step) => ({ ...step, status: "succeed" as const })),
    ...overrides,
  };
};

describe("DashboardView", () => {
  it("renders the Health and Vitals tiles when a scan has completed", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Health");
    expect(frame).toContain("Vitals");
    expect(frame).toContain("Top issues");
    expect(frame).toContain("Categories");
  });

  it("hides the live progress checklist after a scan completes (replaced by tiles)", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={120} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toContain("Scanning…");
    expect(frame).not.toContain("Detecting framework");
    expect(frame).not.toContain("Resolving Node runtime");
  });

  it("shows a Scanning… progress tile during the very first scan (before any results)", () => {
    const initial = buildInitialState("/repo");
    const scanningState: AppState = {
      ...initial,
      project: SAMPLE_PROJECT,
      scanStatus: "scanning",
      scanCount: 0,
      steps: initial.steps.map((step, stepIndex) =>
        stepIndex < 2 ? { ...step, status: "succeed" } : step,
      ),
    };
    const { lastFrame } = render(<DashboardView state={scanningState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Scanning…");
    expect(frame).toContain("Health");
    expect(frame).not.toContain("Top issues");
    expect(frame).not.toContain("Vitals");
  });

  it("keeps the dashboard visible during a re-scan and shows a rescanning indicator", () => {
    const rescanningState = stateWithDiagnostics({ scanStatus: "scanning" });
    const { lastFrame } = render(<DashboardView state={rescanningState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Vitals");
    expect(frame).toContain("Top issues");
    expect(frame).toContain("rescanning");
  });

  it("shows a prominent error banner when the scan fails", () => {
    const erroredState = stateWithDiagnostics({
      scanStatus: "error",
      errorMessage: "oxlint native binding not found",
    });
    const { lastFrame } = render(<DashboardView state={erroredState} terminalColumns={120} />);
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("Scan failed");
    expect(frame).toContain("oxlint native binding not found");
    expect(frame).not.toContain("Top issues");
  });

  it("stacks tiles vertically when the terminal is narrower than the breakpoint", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={50} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    const healthIndex = frame.indexOf("Health");
    const vitalsIndex = frame.indexOf("Vitals");
    expect(healthIndex).toBeGreaterThanOrEqual(0);
    expect(vitalsIndex).toBeGreaterThan(healthIndex);
    const between = frame.slice(healthIndex, vitalsIndex);
    expect(between).toContain("\n");
  });

  it("places Health and Vitals on the same row when the terminal is wide", () => {
    const { lastFrame } = render(
      <DashboardView state={stateWithDiagnostics()} terminalColumns={140} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = frame.split("\n");
    const sharedLine = lines.find((line) => line.includes("Health") && line.includes("Vitals"));
    expect(sharedLine).toBeDefined();
  });
});
