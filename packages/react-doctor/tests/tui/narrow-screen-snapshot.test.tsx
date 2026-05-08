import { describe, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DashboardView } from "../../src/tui/components/dashboard-view.js";
import { ReviewView } from "../../src/tui/components/review-view.js";
import { buildInitialState } from "../../src/tui/store.js";
import type { AppState, GroupedRule } from "../../src/tui/types.js";
import type { Diagnostic, ProjectInfo } from "../../src/types.js";

const SAMPLE_PROJECT: ProjectInfo = {
  rootDirectory: "/workspace",
  projectName: "workspace",
  reactVersion: "19.2.0",
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  sourceFileCount: 30,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/workspace/packages/react-doctor/tests/fixtures/basic-react/src/design-issues.tsx",
  plugin: "react-doctor",
  rule: "no-disabled-zoom",
  severity: "error",
  message:
    "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove it and fix layout if it breaks at 200% zoom",
  help: "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag. If your layout breaks at 200% zoom, fix the layout — don't punish users with disabilities",
  line: 128,
  column: 1,
  category: "accessibility",
  ...overrides,
});

const heavyState = (): AppState => {
  const baseState = buildInitialState("/workspace");
  const rules: GroupedRule[] = [
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
      ruleKey: "react-doctor/no-disabled-zoom",
      plugin: "react-doctor",
      rule: "no-disabled-zoom",
      severity: "error",
      category: "accessibility",
      message:
        "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4)",
      help: "Remove `user-scalable=no` and `maximum-scale` from the viewport meta tag",
      diagnostics: Array.from({ length: 3 }, () => buildDiagnostic()),
    },
  ];
  return {
    ...baseState,
    project: SAMPLE_PROJECT,
    scanStatus: "complete",
    score: { score: 12, label: "Critical" },
    diagnostics: rules.flatMap((rule) => rule.diagnostics),
    filteredDiagnostics: rules.flatMap((rule) => rule.diagnostics),
    groupedRules: rules,
    selectedRuleIndex: 2,
    selectedSiteIndex: 0,
    scanCount: 1,
    lastScanElapsedMs: 1500,
  };
};

describe("narrow-screen visual snapshots", () => {
  it("logs the review screen at 100 cols (side-by-side panes)", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={100} terminalRows={32} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== REVIEW @ 100 cols =====\n${frame}\n=============================\n`);
    }
  });

  it("logs the review screen at 91 cols (matches the user's screenshot width)", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={91} terminalRows={32} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(`\n===== REVIEW @ 91 cols =====\n${frame}\n============================\n`);
    }
  });

  it("logs the review screen at 80 cols (matches the user's screenshot)", () => {
    const { lastFrame } = render(
      <ReviewView state={heavyState()} terminalColumns={80} terminalRows={32} />,
    );
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(
        `\n===== REVIEW @ 80 cols =====\n${frame}\n============================\n`,
      );
    }
  });

  it("logs the dashboard at 70 cols", () => {
    const { lastFrame } = render(<DashboardView state={heavyState()} terminalColumns={70} />);
    const frame = lastFrame() ?? "";
    if (process.env.SNAPSHOT_LOG === "1") {
      process.stdout.write(
        `\n===== DASHBOARD @ 70 cols =====\n${frame}\n===============================\n`,
      );
    }
  });
});
