import { describe, expect, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { ReviewView } from "../../src/tui/components/review-view.js";
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
  help: "",
  line: 14,
  column: 1,
  category: "state-effects",
  ...overrides,
});

const populatedState = (): AppState => {
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
    score: { score: 82, label: "Great" },
    diagnostics: rule.diagnostics,
    matchedDiagnostics: rule.diagnostics,
    groupedRules: [rule],
    scanCount: 1,
    lastScanElapsedMs: 1500,
    steps: baseState.steps.map((step) => ({ ...step, status: "succeed" as const })),
  };
};

describe("responsive layout", () => {
  it("renders the dashboard at every common terminal width without throwing", () => {
    for (const columnsForBreakpoint of [40, 60, 80, 100, 120, 160, 200]) {
      const { lastFrame, unmount } = render(
        <DashboardView state={populatedState()} terminalColumns={columnsForBreakpoint} />,
      );
      const frame = lastFrame();
      expect(typeof frame).toBe("string");
      unmount();
    }
  });

  it("shrinks the score bar when the terminal is narrow", () => {
    const wide = render(<DashboardView state={populatedState()} terminalColumns={140} />);
    const wideFrame = stripAnsi(wide.lastFrame() ?? "");
    const wideBarRow = wideFrame.split("\n").find((line) => line.includes("█")) ?? "";
    wide.unmount();
    const narrow = render(<DashboardView state={populatedState()} terminalColumns={50} />);
    const narrowFrame = stripAnsi(narrow.lastFrame() ?? "");
    const narrowBarRow = narrowFrame.split("\n").find((line) => line.includes("█")) ?? "";
    narrow.unmount();
    const wideBarLength = (wideBarRow.match(/[█░]/g) ?? []).length;
    const narrowBarLength = (narrowBarRow.match(/[█░]/g) ?? []).length;
    expect(wideBarLength).toBeGreaterThan(narrowBarLength);
  });

  it("stacks the review master/detail panes when the terminal is very narrow", () => {
    const wide = render(
      <ReviewView state={populatedState()} terminalColumns={120} terminalRows={32} />,
    );
    const wideFrame = stripAnsi(wide.lastFrame() ?? "");
    const wideListIndex = wideFrame.indexOf("react-doctor/no-fetch-in-effect");
    const wideDetailIndex = wideFrame.indexOf("Avoid fetch inside useEffect.");
    expect(wideListIndex).toBeGreaterThanOrEqual(0);
    expect(wideDetailIndex).toBeGreaterThanOrEqual(0);
    wide.unmount();

    const narrow = render(
      <ReviewView state={populatedState()} terminalColumns={45} terminalRows={32} />,
    );
    const narrowFrame = stripAnsi(narrow.lastFrame() ?? "");
    expect(narrowFrame).toContain("react-doctor/no-fetch-in-effect");
    expect(narrowFrame).toContain("Avoid fetch inside useEffect.");
    narrow.unmount();
  });
});
