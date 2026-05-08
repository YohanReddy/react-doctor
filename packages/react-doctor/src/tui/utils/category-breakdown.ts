import type { Diagnostic } from "../../types.js";
import type { CategoryBreakdown } from "../types.js";

export const computeCategoryBreakdown = (diagnostics: Diagnostic[]): CategoryBreakdown[] => {
  const breakdownByCategory = new Map<string, CategoryBreakdown>();
  for (const diagnostic of diagnostics) {
    const category = diagnostic.category || "uncategorized";
    const existing = breakdownByCategory.get(category) ?? {
      category,
      errorCount: 0,
      warningCount: 0,
      total: 0,
    };
    if (diagnostic.severity === "error") existing.errorCount += 1;
    else existing.warningCount += 1;
    existing.total += 1;
    breakdownByCategory.set(category, existing);
  }
  return [...breakdownByCategory.values()].sort(
    (firstEntry, secondEntry) => secondEntry.total - firstEntry.total,
  );
};
