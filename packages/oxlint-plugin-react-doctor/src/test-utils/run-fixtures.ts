import { describe, expect, it } from "vite-plus/test";
import { runRule } from "./run-rule.js";
import type { Rule } from "../plugin/utils/rule.js";

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  // Some OXC tests pin a specific filename (`PathBuf::from("foo.jsx")`)
  // as their fourth tuple element. The fixture extractor preserves it
  // here so per-rule tests can pass it through to context.getFilename().
  oxcFilename?: string;
}

export interface RunFixturesOptions {
  // Cases the upstream OXC test file expects to PASS but our port flags
  // (or vice versa) — listed as integer indices into the `passCases` /
  // `failCases` array so the test still runs but doesn't fail. Use
  // sparingly and only with a documented justification (e.g. "oxc port
  // depends on scope analysis we don't have").
  knownPassDivergences?: ReadonlyArray<number>;
  knownFailDivergences?: ReadonlyArray<number>;
  // Some rules in OXC use a configuration tuple that doesn't translate
  // 1-to-1 to our settings shape. When set, `translateOxcFixture`
  // converts an OXC `oxcOptions` / `oxcSettings` pair into the
  // `react-doctor.<rule>` settings shape our `create()` consumes.
  translateOxcFixture?: (fixture: OxcFixture) => Record<string, unknown> | null;
}

const buildSettingsForFixture = (
  fixture: OxcFixture,
  options: RunFixturesOptions,
): Record<string, unknown> | undefined => {
  if (!options.translateOxcFixture) return undefined;
  const translated = options.translateOxcFixture(fixture);
  return translated ?? undefined;
};

const summarizeFixtureCode = (rawCode: string): string => {
  const collapsed = rawCode.trim().replace(/\s+/g, " ");
  return collapsed.length <= 80 ? collapsed : `${collapsed.slice(0, 77)}…`;
};

// Mirrors OXC's `Tester::new(rule, pass, fail).test()` shape: every
// fixture in `passCases` is expected to produce zero diagnostics; every
// fixture in `failCases` is expected to produce ≥1. Indices listed in
// `knownPassDivergences` / `knownFailDivergences` are skipped via
// `it.skip(...)` with a self-documenting label.
export const runOxcFixtures = (
  ruleName: string,
  rule: Rule,
  fixtures: { passCases: ReadonlyArray<OxcFixture>; failCases: ReadonlyArray<OxcFixture> },
  options: RunFixturesOptions = {},
): void => {
  const passSkips = new Set(options.knownPassDivergences ?? []);
  const failSkips = new Set(options.knownFailDivergences ?? []);

  // We don't assert on `result.parseErrors` because OXC's upstream
  // fixture suite intentionally includes some non-self-contained
  // snippets (`return` outside a function, intentionally-unbalanced
  // JSX entities, etc.) where the rule should still produce the
  // expected verdict on whatever sub-tree the parser DID build. The
  // strictness is recovered by checking diagnostic counts only.
  if (fixtures.passCases.length > 0) {
    describe(`${ruleName} — OXC pass cases`, () => {
      fixtures.passCases.forEach((fixture, fixtureIndex) => {
        const label = `pass[${fixtureIndex}]: ${summarizeFixtureCode(fixture.code)}`;
        const runner = passSkips.has(fixtureIndex) ? it.skip : it;
        runner(label, () => {
          const settings = buildSettingsForFixture(fixture, options);
          const result = runRule(rule, fixture.code, {
            settings,
            filename: fixture.oxcFilename,
            forceJsx: true,
          });
          expect(result.diagnostics).toEqual([]);
        });
      });
    });
  }

  if (fixtures.failCases.length > 0) {
    describe(`${ruleName} — OXC fail cases`, () => {
      fixtures.failCases.forEach((fixture, fixtureIndex) => {
        const label = `fail[${fixtureIndex}]: ${summarizeFixtureCode(fixture.code)}`;
        const runner = failSkips.has(fixtureIndex) ? it.skip : it;
        runner(label, () => {
          const settings = buildSettingsForFixture(fixture, options);
          const result = runRule(rule, fixture.code, {
            settings,
            filename: fixture.oxcFilename,
            forceJsx: true,
          });
          expect(result.diagnostics.length).toBeGreaterThan(0);
        });
      });
    });
  }
};
