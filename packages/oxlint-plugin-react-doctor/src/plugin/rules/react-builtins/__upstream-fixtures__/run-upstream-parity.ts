import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, it, expect } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import type { Rule } from "../../../utils/rule.js";

interface UpstreamCase {
  code: string;
  name?: string;
  filename?: string;
  syntax?: string;
  options?: ReadonlyArray<unknown>;
  settings?: Readonly<Record<string, unknown>>;
  errorCount?: number;
  errors?: ReadonlyArray<unknown>;
  skip?: boolean;
  only?: boolean;
}

interface UpstreamFixture {
  valid: ReadonlyArray<UpstreamCase>;
  invalid: ReadonlyArray<UpstreamCase>;
}

interface UpstreamSkipEntry {
  // 0-based index into the relevant `valid` / `invalid` array.
  index: number;
  // Optional human-readable reason — surfaced when the test is reported.
  reason?: string;
}

export interface UpstreamParityOptions {
  // `valid` cases the rule incorrectly flags (false positives).
  validSkips?: ReadonlyArray<number | UpstreamSkipEntry>;
  // `invalid` cases the rule reports a different count for (false
  // negatives or over-reports).
  invalidSkips?: ReadonlyArray<number | UpstreamSkipEntry>;
  // Optional translator that turns upstream `options[0]` (the
  // first-arg config eslint-plugin-react-hooks accepts) into the
  // `settings: { "react-doctor": { <ruleKey>: …} }` shape our rule
  // reads.
  translateOptions?: (
    upstreamOptions: ReadonlyArray<unknown> | undefined,
  ) => Readonly<Record<string, unknown>> | undefined;
}

const fixturesDirectory = path.dirname(url.fileURLToPath(import.meta.url));

const loadFixture = (slug: string): UpstreamFixture =>
  JSON.parse(fs.readFileSync(path.join(fixturesDirectory, `${slug}.json`), "utf8"));

const truncate = (text: string, max = 70): string => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
};

const skipIndices = (
  entries: ReadonlyArray<number | UpstreamSkipEntry> | undefined,
): ReadonlySet<number> => {
  if (!entries) return new Set();
  const out = new Set<number>();
  for (const entry of entries) {
    if (typeof entry === "number") out.add(entry);
    else out.add(entry.index);
  }
  return out;
};

// Drives the upstream `eslint-plugin-react-hooks` test fixtures through
// our ported rule via the `runRule` harness. Each upstream case becomes
// one `it(...)` that asserts diagnostic counts match upstream's.
export const runUpstreamParity = (
  fixtureSlug: string,
  rule: Rule,
  options: UpstreamParityOptions = {},
): void => {
  const fixture = loadFixture(fixtureSlug);
  const validSkipSet = skipIndices(options.validSkips);
  const invalidSkipSet = skipIndices(options.invalidSkips);

  describe(`${fixtureSlug} upstream parity (eslint-plugin-react-hooks)`, () => {
    fixture.valid.forEach((testCase, caseIndex) => {
      const isSkipped = testCase.skip || validSkipSet.has(caseIndex);
      const itFunction = isSkipped ? it.skip : it;
      const label = `valid #${caseIndex} ${testCase.name ?? truncate(testCase.code)}`;
      itFunction(label, () => {
        const settings =
          options.translateOptions !== undefined
            ? options.translateOptions(testCase.options)
            : testCase.settings;
        const filename = testCase.filename ?? "Component.tsx";
        const result = runRule(rule, testCase.code, { filename, settings, forceJsx: true });
        expect(result.diagnostics).toHaveLength(0);
      });
    });

    fixture.invalid.forEach((testCase, caseIndex) => {
      const isSkipped = testCase.skip || invalidSkipSet.has(caseIndex);
      const itFunction = isSkipped ? it.skip : it;
      const expectedErrorCount = testCase.errorCount ?? 1;
      const label = `invalid #${caseIndex} ${testCase.name ?? truncate(testCase.code)}`;
      itFunction(label, () => {
        const settings =
          options.translateOptions !== undefined
            ? options.translateOptions(testCase.options)
            : testCase.settings;
        const filename = testCase.filename ?? "Component.tsx";
        const result = runRule(rule, testCase.code, { filename, settings, forceJsx: true });
        expect(result.diagnostics).toHaveLength(expectedErrorCount);
      });
    });
  });
};
