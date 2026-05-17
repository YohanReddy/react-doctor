import * as eslintVisitorKeys from "eslint-visitor-keys";

export const MAX_EXPRESSION_SNIPPET_ITEMS_COUNT = 3;

const TYPESCRIPT_VISITOR_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  TSAsExpression: ["expression", "typeAnnotation"],
  TSNonNullExpression: ["expression"],
  TSSatisfiesExpression: ["expression", "typeAnnotation"],
  TSTypeAssertion: ["typeAnnotation", "expression"],
  TSInstantiationExpression: ["expression", "typeArguments"],
};

export const VISITOR_KEYS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ...eslintVisitorKeys.KEYS,
  ...TYPESCRIPT_VISITOR_KEYS,
};
