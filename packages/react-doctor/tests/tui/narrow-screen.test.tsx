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
  filePath: "/repo/packages/react-doctor/tests/fixtures/basic-react/src/design-issues.tsx",
  plugin: "react-doctor",
  rule: "no-disabled-zoom",
  severity: "error",
  message:
    "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove it and fix layout if it breaks at 200% zoom.",
  help: "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If your layout breaks at 200% zoom, fix the layout — don't punish users with disabilities.",
  line: 128,
  column: 1,
  category: "accessibility",
  ...overrides,
});

const heavyRules: GroupedRule[] = [
  {
    ruleKey: "react-doctor/rerender-dependencies",
    plugin: "react-doctor",
    rule: "rerender-dependencies",
    severity: "error",
    category: "performance",
    message: "Avoid creating new references inside render.",
    help: "",
    diagnostics: Array.from({ length: 4 }, () => buildDiagnostic()),
  },
  {
    ruleKey: "react-doctor/effect-needs-cleanup",
    plugin: "react-doctor",
    rule: "effect-needs-cleanup",
    severity: "error",
    category: "state-effects",
    message: "Effects with subscriptions need cleanup.",
    help: "",
    diagnostics: Array.from({ length: 3 }, () => buildDiagnostic()),
  },
  {
    ruleKey: "react-doctor/server-no-mutable-module-state",
    plugin: "react-doctor",
    rule: "server-no-mutable-module-state",
    severity: "error",
    category: "architecture",
    message: "Module-level mutable state is unsafe in server components.",
    help: "",
    diagnostics: Array.from({ length: 3 }, () => buildDiagnostic()),
  },
  {
    ruleKey: "react-doctor/no-disabled-zoom",
    plugin: "react-doctor",
    rule: "no-disabled-zoom",
    severity: "error",
    category: "accessibility",
    message:
      "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove it and fix layout if it breaks at 200% zoom",
    help: "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If your layout breaks at 200% zoom, fix the layout — don't punish users with disabilities.",
    diagnostics: Array.from({ length: 3 }, () => buildDiagnostic()),
  },
];

const heavyState = (): AppState => {
  const baseState = buildInitialState("/repo");
  const allDiagnostics = heavyRules.flatMap((rule) => rule.diagnostics);
  return {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 12, label: "Critical" },
    diagnostics: allDiagnostics,
    matchedDiagnostics: allDiagnostics,
    groupedRules: heavyRules,
    selectedRuleIndex: 3,
    selectedSiteIndex: 0,
    scanCount: 1,
    lastScanElapsedMs: 1500,
  };
};

describe("review-view at narrow widths (regression: rule names wrapping mid-word)", () => {
  it("stacks the master and detail panes when the terminal is narrower than 90 cols", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={80} terminalRows={32} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = frame.split("\n");
    const sharedLine = lines.find(
      (line) =>
        line.includes("react-doctor/no-disabled-zoom") && line.includes("react-doctor/rerender"),
    );
    expect(sharedLine).toBeUndefined();
  });

  it("never lets the rule name overflow the diagnostic list pane width", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={120} terminalRows={32} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = frame.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(120);
    }
  });

  it("ellipsizes long rule names in the master list and the detail header", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={70} terminalRows={32} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).toContain("…");
  });

  it("avoids fragments like 'react-doctor/no-disabled-z' followed by 'om' on the next line", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={80} terminalRows={32} />,
    );
    const frame = stripAnsi(lastFrame() ?? "");
    expect(frame).not.toMatch(/no-disabled-z\s*\n\s*om/);
  });
});

describe("dashboard at narrow widths", () => {
  it("does not let the focused-issue snippet wrap past the terminal width", () => {
    const { lastFrame } = render(<DashboardView state={heavyState()} terminalColumns={70} />);
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = frame.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });
});
