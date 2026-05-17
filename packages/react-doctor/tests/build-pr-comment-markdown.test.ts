import { describe, expect, it } from "vite-plus/test";
import type {
  Diagnostic,
  JsonReport,
  JsonReportProjectEntry,
  ProjectInfo,
} from "@react-doctor/types";
import { buildPrCommentMarkdown } from "../src/cli/utils/build-pr-comment-markdown.js";

const sampleProjectInfo: ProjectInfo = {
  rootDirectory: "/repo/apps/web",
  projectName: "apps/web",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "nextjs",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: false,
  sourceFileCount: 200,
};

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/apps/web/src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  message: "Array index used as React key",
  help: "",
  line: 12,
  column: 4,
  category: "Correctness",
  ...overrides,
});

const buildProjectEntry = (
  overrides: Partial<JsonReportProjectEntry> = {},
): JsonReportProjectEntry => ({
  directory: "/repo/apps/web",
  project: sampleProjectInfo,
  diagnostics: [],
  score: { score: 86, label: "Great" },
  skippedChecks: [],
  elapsedMilliseconds: 1234,
  ...overrides,
});

const buildJsonReport = (overrides: Partial<JsonReport>): JsonReport => ({
  schemaVersion: 1,
  version: "0.0.0",
  ok: true,
  directory: "/repo",
  mode: "full",
  diff: null,
  projects: [],
  diagnostics: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    affectedFileCount: 0,
    totalDiagnosticCount: 0,
    score: null,
    scoreLabel: null,
    baselineDiagnosticCount: 0,
  },
  elapsedMilliseconds: 1000,
  error: null,
  ...overrides,
});

describe("buildPrCommentMarkdown", () => {
  it("emits a sticky-comment marker on the first line", () => {
    const markdown = buildPrCommentMarkdown(buildJsonReport({}));
    expect(markdown.startsWith("<!-- react-doctor -->")).toBe(true);
  });

  it("renders a celebratory message when there are no diagnostics", () => {
    const markdown = buildPrCommentMarkdown(buildJsonReport({}));
    expect(markdown).toContain("No issues found.");
  });

  it("frames the comment as no-new-violations when only baseline issues remain", () => {
    const markdown = buildPrCommentMarkdown(
      buildJsonReport({
        summary: {
          errorCount: 0,
          warningCount: 0,
          affectedFileCount: 0,
          totalDiagnosticCount: 0,
          score: 70,
          scoreLabel: "Needs work",
          baselineDiagnosticCount: 9,
        },
      }),
    );
    expect(markdown).toContain("no new violations introduced by this PR");
  });

  it("groups diagnostics by rule and includes a suppression snippet", () => {
    const errorDiagnostic = buildDiagnostic();
    const warningDiagnostic = buildDiagnostic({
      severity: "warning",
      rule: "no-direct-state-mutation",
      message: "Direct state mutation",
      filePath: "/repo/apps/web/src/Other.tsx",
      line: 4,
    });
    const project = buildProjectEntry({ diagnostics: [errorDiagnostic, warningDiagnostic] });
    const markdown = buildPrCommentMarkdown(
      buildJsonReport({
        projects: [project],
        diagnostics: [errorDiagnostic, warningDiagnostic],
        summary: {
          errorCount: 1,
          warningCount: 1,
          affectedFileCount: 2,
          totalDiagnosticCount: 2,
          score: 86,
          scoreLabel: "Great",
          baselineDiagnosticCount: 0,
        },
      }),
      { baseDirectory: "/repo" },
    );
    expect(markdown).toContain("react-doctor/no-array-index-as-key");
    expect(markdown).toContain("react-doctor/no-direct-state-mutation");
    expect(markdown).toContain("`apps/web/src/App.tsx:12`");
    expect(markdown).toContain("Suppress with:");
  });

  it("does not double-count partially-rendered groups in the overflow footer", () => {
    // 30 diagnostics under one rule: the bullet list caps at
    // MAX_INLINE_DIAGNOSTICS (25), so the group's <summary> claims
    // "30 occurrences" with an inline "+5 more in this rule" line.
    // The footer must NOT then claim "5 more findings hidden" - that
    // would double-count the same 5 diagnostics.
    const manyDiagnostics: Diagnostic[] = Array.from({ length: 30 }, (_, index) =>
      buildDiagnostic({ line: index + 1 }),
    );
    const markdown = buildPrCommentMarkdown(
      buildJsonReport({
        projects: [buildProjectEntry({ diagnostics: manyDiagnostics })],
        diagnostics: manyDiagnostics,
        summary: {
          errorCount: 30,
          warningCount: 0,
          affectedFileCount: 1,
          totalDiagnosticCount: 30,
          score: 70,
          scoreLabel: "Needs work",
          baselineDiagnosticCount: 0,
        },
      }),
    );
    expect(markdown).toContain("+5 more in this rule");
    expect(markdown).not.toContain("findings hidden");
  });

  it("renders a per-package section for monorepos with multiple projects", () => {
    const projectA = buildProjectEntry({
      directory: "/repo/apps/web",
      project: { ...sampleProjectInfo, projectName: "apps/web" },
      diagnostics: [buildDiagnostic()],
      score: { score: 72, label: "Needs work" },
    });
    const projectB = buildProjectEntry({
      directory: "/repo/packages/ui",
      project: {
        ...sampleProjectInfo,
        projectName: "packages/ui",
        rootDirectory: "/repo/packages/ui",
      },
      diagnostics: [],
      score: { score: 95, label: "Excellent" },
    });
    const markdown = buildPrCommentMarkdown(
      buildJsonReport({
        projects: [projectA, projectB],
        diagnostics: [buildDiagnostic()],
        summary: {
          errorCount: 1,
          warningCount: 0,
          affectedFileCount: 1,
          totalDiagnosticCount: 1,
          score: 72,
          scoreLabel: "Needs work",
          baselineDiagnosticCount: 0,
        },
      }),
      { baseDirectory: "/repo" },
    );
    expect(markdown).toContain("Per-package summary");
    expect(markdown).toContain("apps/web");
    expect(markdown).toContain("packages/ui");
  });

  it("notes when touched-line filtering hid diagnostics", () => {
    const project = buildProjectEntry({
      diagnostics: [],
      diagnosticsHiddenByTouchedLines: 5,
    });
    const markdown = buildPrCommentMarkdown(
      buildJsonReport({
        projects: [project],
        diagnostics: [],
      }),
    );
    expect(markdown).toContain("hidden by touched-line filtering");
  });
});
