import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../../src/types.js";
import { filterDiagnosticsByText } from "../../src/tui/utils/filter-diagnostics.js";

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

describe("filterDiagnosticsByText", () => {
  it("returns all diagnostics for an empty filter", () => {
    const diagnostics = [buildDiagnostic(), buildDiagnostic({ rule: "no-fetch-in-effect" })];
    expect(filterDiagnosticsByText(diagnostics, "")).toHaveLength(2);
    expect(filterDiagnosticsByText(diagnostics, "   ")).toHaveLength(2);
  });

  it("matches against the rule, plugin, category, message, and file path", () => {
    const diagnostics = [
      buildDiagnostic({ rule: "no-array-index-as-key", filePath: "/repo/src/Feed.tsx" }),
      buildDiagnostic({ rule: "no-fetch-in-effect", filePath: "/repo/src/UserCard.tsx" }),
      buildDiagnostic({
        rule: "no-derived-state-effect",
        filePath: "/repo/src/Profile.tsx",
        category: "state-effects",
      }),
    ];
    expect(filterDiagnosticsByText(diagnostics, "feed")).toHaveLength(1);
    expect(filterDiagnosticsByText(diagnostics, "fetch")).toHaveLength(1);
    expect(filterDiagnosticsByText(diagnostics, "state-effects")).toHaveLength(1);
    expect(filterDiagnosticsByText(diagnostics, "Avoid")).toHaveLength(3);
  });

  it("treats search terms case-insensitively", () => {
    const diagnostics = [buildDiagnostic({ filePath: "/repo/src/UserCard.tsx" })];
    expect(filterDiagnosticsByText(diagnostics, "USERCARD")).toHaveLength(1);
    expect(filterDiagnosticsByText(diagnostics, "usercard")).toHaveLength(1);
  });
});
