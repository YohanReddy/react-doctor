import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../../src/types.js";
import { groupDiagnosticsByRule } from "../../src/tui/utils/group-diagnostics.js";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "/repo/src/App.tsx",
  plugin: "react-doctor",
  rule: "no-fetch-in-effect",
  severity: "warning",
  message: "Avoid fetch inside useEffect.",
  help: "Use a data-fetching library.",
  line: 10,
  column: 1,
  category: "state-effects",
  ...overrides,
});

describe("groupDiagnosticsByRule", () => {
  it("groups diagnostics that share a plugin/rule key", () => {
    const grouped = groupDiagnosticsByRule([
      buildDiagnostic({ rule: "no-fetch-in-effect" }),
      buildDiagnostic({ rule: "no-fetch-in-effect", line: 20 }),
      buildDiagnostic({ rule: "no-array-index-as-key" }),
    ]);
    expect(grouped).toHaveLength(2);
    const fetchGroup = grouped.find((entry) => entry.rule === "no-fetch-in-effect");
    expect(fetchGroup?.diagnostics).toHaveLength(2);
  });

  it("sorts errors before warnings, then by count desc", () => {
    const grouped = groupDiagnosticsByRule([
      buildDiagnostic({ rule: "warn-rule", severity: "warning" }),
      buildDiagnostic({ rule: "warn-rule", severity: "warning", line: 11 }),
      buildDiagnostic({ rule: "warn-rule", severity: "warning", line: 12 }),
      buildDiagnostic({ rule: "err-rule", severity: "error" }),
      buildDiagnostic({ rule: "err-rule", severity: "error", line: 21 }),
    ]);
    expect(grouped[0].rule).toBe("err-rule");
    expect(grouped[0].severity).toBe("error");
    expect(grouped[1].rule).toBe("warn-rule");
  });
});
