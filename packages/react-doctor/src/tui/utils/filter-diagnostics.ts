import type { Diagnostic } from "../../types.js";

const matchesSearchTerm = (diagnostic: Diagnostic, lowercaseTerm: string): boolean => {
  if (lowercaseTerm.length === 0) return true;
  if (diagnostic.rule.toLowerCase().includes(lowercaseTerm)) return true;
  if (diagnostic.plugin.toLowerCase().includes(lowercaseTerm)) return true;
  if (diagnostic.category.toLowerCase().includes(lowercaseTerm)) return true;
  if (diagnostic.message.toLowerCase().includes(lowercaseTerm)) return true;
  if (diagnostic.filePath.toLowerCase().includes(lowercaseTerm)) return true;
  return false;
};

export const filterDiagnosticsByText = (
  diagnostics: Diagnostic[],
  searchText: string,
): Diagnostic[] => {
  const lowercaseTerm = searchText.trim().toLowerCase();
  if (lowercaseTerm.length === 0) return diagnostics;
  return diagnostics.filter((diagnostic) => matchesSearchTerm(diagnostic, lowercaseTerm));
};
