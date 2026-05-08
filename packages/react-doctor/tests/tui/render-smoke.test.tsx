import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import path from "node:path";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { ReviewView } from "../../src/tui/components/review-view.js";
import { Header } from "../../src/tui/components/header.js";
import { InlineProgress } from "../../src/tui/components/inline-progress.js";
import { ScoreGauge } from "../../src/tui/components/score-gauge.js";
import { DoctorFace } from "../../src/tui/components/doctor-face.js";
import { buildInitialState } from "../../src/tui/store.js";
import type { AppState, GroupedRule } from "../../src/tui/types.js";
import type { Diagnostic, ProjectInfo } from "../../src/types.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "demo",
  reactVersion: "19.2.0",
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: true,
  sourceFileCount: 42,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: path.join(SAMPLE_PROJECT.rootDirectory, "src/App.tsx"),
  plugin: "react-doctor",
  rule: "no-fetch-in-effect",
  severity: "warning",
  message: "Avoid fetch inside useEffect.",
  help: "Use a data-fetching library.",
  line: 14,
  column: 1,
  category: "state-effects",
  ...overrides,
});

const populatedState = (): AppState => {
  const baseState = buildInitialState("/repo");
  const groupedRule: GroupedRule = {
    ruleKey: "react-doctor/no-fetch-in-effect",
    plugin: "react-doctor",
    rule: "no-fetch-in-effect",
    severity: "error",
    category: "state-effects",
    message: "Avoid fetch inside useEffect.",
    help: "Use a data-fetching library.",
    diagnostics: [buildDiagnostic({ severity: "error" }), buildDiagnostic({ line: 99 })],
  };
  const populated: AppState = {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 78, label: "Great" },
    previousScore: { score: 72, label: "Needs work" },
    diagnostics: groupedRule.diagnostics,
    filteredDiagnostics: groupedRule.diagnostics,
    groupedRules: [groupedRule],
    selectedRuleIndex: 0,
    selectedSiteIndex: 0,
    lastScanElapsedMs: 1234,
    scanCount: 1,
    isOffline: false,
    scoreHistory: [],
  };
  return populated;
};

describe("Ink components render without throwing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the Header showing the project path", () => {
    const { lastFrame } = render(<Header rootDirectory="/repo/projects/ami" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/repo/projects/ami");
  });

  it("renders the DoctorFace as a 4-line ASCII box", () => {
    const { lastFrame, unmount } = render(<DoctorFace mood="great" isAnimating={false} />);
    expect(lastFrame()).toContain("┌─────┐");
    expect(lastFrame()).toContain("└─────┘");
    unmount();
  });

  it("renders the ScoreGauge with score, label, bar, and delta", () => {
    const { lastFrame } = render(
      <ScoreGauge score={82} label="Great" previousScore={75} barWidth={24} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/ 100");
    expect(frame).toMatch(/Great/);
    expect(frame).toMatch(/▲ 7/);
  });

  it("renders InlineProgress as a single line with the active step and a stage counter", () => {
    const { lastFrame } = render(
      <InlineProgress
        steps={[
          { id: "framework", message: "Detecting framework", status: "succeed" },
          { id: "lint", message: "Running lint checks…", status: "running" },
          { id: "score", message: "Calculating score", status: "pending" },
        ]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Running lint checks");
    expect(frame).toContain("(1/");
    expect(frame).not.toContain("Detecting framework");
  });

  it("renders the focused dashboard for a populated state", () => {
    const { lastFrame, unmount } = render(
      <DashboardView state={populatedState()} terminalColumns={120} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("react-doctor/no-fetch-in-effect");
    expect(frame).toContain("Avoid fetch inside useEffect.");
    expect(frame).toMatch(/Last scan/);
    unmount();
  });

  it("renders the review master/detail layout for a populated state", () => {
    const { lastFrame } = render(
      <ReviewView state={populatedState()} terminalColumns={120} terminalRows={32} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("react-doctor/no-fetch-in-effect");
    expect(frame).toContain("site");
    expect(frame).toContain("Avoid fetch inside useEffect.");
  });
});
