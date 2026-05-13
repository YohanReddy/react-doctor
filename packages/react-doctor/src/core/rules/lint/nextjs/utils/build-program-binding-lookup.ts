import type { EsTreeNode } from "../../utils/index.js";
import { isNodeOfType } from "../../utils/index.js";

// Builds a fast lookup from top-level `const`/`let`/`var` identifier names
// to their initializer expression. Used to resolve framework adapter
// exports such as `export const GET = handle(app)` back to the chained
// router builder declared elsewhere in the same module.
export const buildProgramBindingLookup = (
  programNode: EsTreeNode,
): ((identifierName: string) => EsTreeNode | null) => {
  const bindings = new Map<string, EsTreeNode>();
  if (!isNodeOfType(programNode, "Program")) {
    return () => null;
  }
  const collect = (statements: EsTreeNode[]): void => {
    for (const statement of statements) {
      if (isNodeOfType(statement, "VariableDeclaration")) {
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          if (!declarator.init) continue;
          bindings.set(declarator.id.name, declarator.init);
        }
        continue;
      }
      if (isNodeOfType(statement, "ExportNamedDeclaration") && statement.declaration) {
        collect([statement.declaration]);
      }
    }
  };
  collect(programNode.body ?? []);
  return (identifierName: string) => bindings.get(identifierName) ?? null;
};
