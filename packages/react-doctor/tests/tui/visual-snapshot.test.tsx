import { describe, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { ProjectPicker } from "../../src/tui/components/project-picker.js";
import { ReviewView } from "../../src/tui/components/review-view.js";
import { buildInitialState } from "../../src/tui/store.js";
import type { AppState, GroupedRule } from "../../src/tui/types.js";
import type { Diagnostic, ProjectInfo, WorkspacePackage } from "../../src/types.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "ami",
  reactVersion: "19.2.0",
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 142,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/src/components/Feed.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "warning",
  message: "Avoid using array index as a React key.",
  help: "Prefer a stable id field.",
  line: 14,
  column: 5,
  category: "performance",
  ...overrides,
});

const buildPopulatedState = (): AppState => {
  const baseState = buildInitialState("/repo");
  const fetchRule: GroupedRule = {
    ruleKey: "react-doctor/no-fetch-in-effect",
    plugin: "react-doctor",
    rule: "no-fetch-in-effect",
    severity: "error",
    category: "state-effects",
    message: "Avoid fetch inside useEffect.",
    help: "Use a data-fetching library like TanStack Query.",
    diagnostics: [
      buildDiagnostic({
        rule: "no-fetch-in-effect",
        severity: "error",
        category: "state-effects",
        filePath: "/repo/src/UserCard.tsx",
        line: 42,
      }),
      buildDiagnostic({
        rule: "no-fetch-in-effect",
        severity: "error",
        category: "state-effects",
        filePath: "/repo/src/UserCard.tsx",
        line: 88,
      }),
    ],
  };
  const arrayRule: GroupedRule = {
    ruleKey: "react-doctor/no-array-index-as-key",
    plugin: "react-doctor",
    rule: "no-array-index-as-key",
    severity: "warning",
    category: "performance",
    message: "Avoid using array index as a React key.",
    help: "Prefer a stable id field.",
    diagnostics: Array.from({ length: 5 }, (_, innerIndex) =>
      buildDiagnostic({
        line: 14 + innerIndex,
        filePath: `/repo/src/components/Feed${innerIndex}.tsx`,
      }),
    ),
  };
  return {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 82, label: "Great" },
    previousScore: { score: 78, label: "Great" },
    diagnostics: [...fetchRule.diagnostics, ...arrayRule.diagnostics],
    matchedDiagnostics: [...fetchRule.diagnostics, ...arrayRule.diagnostics],
    groupedRules: [fetchRule, arrayRule],
    selectedRuleIndex: 0,
    selectedSiteIndex: 0,
    lastScanElapsedMs: 2300,
    scanCount: 4,
    isWatching: true,
    isOffline: false,
    scoreHistory: [
      { score: 60, diagnosticCount: 12, timestamp: 1 },
      { score: 65, diagnosticCount: 11, timestamp: 2 },
      { score: 70, diagnosticCount: 9, timestamp: 3 },
      { score: 78, diagnosticCount: 8, timestamp: 4 },
      { score: 82, diagnosticCount: 7, timestamp: 5 },
    ],
    steps: baseState.steps.map((step) => ({ ...step, status: "succeed" as const })),
    diagnosticsDirectory: "/tmp/react-doctor-abc123",
    shareUrl: "https://www.react.doctor/share?p=ami&s=82&e=2&w=5&f=6",
  };
};

describe("visual snapshots", () => {
  it("logs the help overlay frame", async () => {
    const { HelpOverlay } = await import("../../src/tui/components/help-overlay.js");
    const { lastFrame } = render(<HelpOverlay />);
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== HELP =====\n${frame}\n================\n`);
    }
  });

  it("logs the header at wide terminal width", async () => {
    const { Header } = await import("../../src/tui/components/header.js");
    const { lastFrame } = render(
      <Header rootDirectory="/Users/me/projects/ami" terminalColumns={120} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== HEADER =====\n${frame}\n==================\n`);
    }
  });

  it("logs a populated dashboard frame at 120 cols", () => {
    const { lastFrame } = render(
      <DashboardView state={buildPopulatedState()} terminalColumns={120} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== DASHBOARD WIDE =====\n${frame}\n=====================\n`);
    }
  });

  it("logs a populated dashboard frame at 60 cols (narrow / stacked)", () => {
    const { lastFrame } = render(
      <DashboardView state={buildPopulatedState()} terminalColumns={60} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== DASHBOARD NARROW =====\n${frame}\n=====================\n`);
    }
  });

  it("logs the project picker frame", () => {
    const samplePackages: WorkspacePackage[] = [
      { name: "ami", directory: "/repo/packages/ami" },
      { name: "admin", directory: "/repo/packages/admin" },
      { name: "docs", directory: "/repo/packages/docs" },
    ];
    const { lastFrame } = render(
      <ProjectPicker rootDirectory="/repo" packages={samplePackages} cursorIndex={1} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== PROJECT PICKER =====\n${frame}\n=========================\n`);
    }
  });

  it("logs a populated review frame", () => {
    const { lastFrame } = render(
      <ReviewView state={buildPopulatedState()} terminalColumns={120} terminalRows={32} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== REVIEW =====\n${frame}\n==================\n`);
    }
  });
});
