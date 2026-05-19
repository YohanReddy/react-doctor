// Directory names that mark a file as part of a test / fixture /
// Storybook / Cypress surface, regardless of the file's own suffix.
const NON_PRODUCTION_PATH_SEGMENTS: ReadonlyArray<string> = [
  "/test/",
  "/tests/",
  "/__tests__/",
  "/__fixtures__/",
  "/fixtures/",
  "/__mocks__/",
  "/mocks/",
  "/cypress/",
  "/.storybook/",
  "/stories/",
];

// True iff `filename` looks like test / spec / Storybook / Cypress
// code — by suffix (`.test.tsx`, `.spec.ts`, `.cy.tsx`, `.stories.tsx`)
// or by sitting inside a recognized test/fixture directory. Used by
// rules whose findings are unactionable in non-production code (a11y
// rules, perf rules, Fast-Refresh-only-export rules) to skip those
// files entirely without forcing users to maintain explicit ignore
// lists.
export const isTestlikeFilename = (filename: string | undefined): boolean => {
  if (!filename) return false;
  if (
    filename.includes(".test.") ||
    filename.includes(".spec.") ||
    filename.includes(".cy.") ||
    filename.includes(".stories.")
  ) {
    return true;
  }
  for (const segment of NON_PRODUCTION_PATH_SEGMENTS) {
    if (filename.includes(segment)) return true;
  }
  return false;
};
