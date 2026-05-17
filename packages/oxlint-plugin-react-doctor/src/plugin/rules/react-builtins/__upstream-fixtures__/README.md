# Upstream parity fixtures

JSON snapshots of the test cases shipped by
[`facebook/react`'s `eslint-plugin-react-hooks`](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks).
The runner in `run-upstream-parity.ts` replays every case through our
native TypeScript ports of `rules-of-hooks` and `exhaustive-deps`,
asserting the diagnostic count matches upstream's expectation.

## Source pin

| Rule              | Upstream file                                | Pinned tag                        |
| ----------------- | -------------------------------------------- | --------------------------------- |
| `rules-of-hooks`  | `__tests__/ESLintRulesOfHooks-test.js`       | `eslint-plugin-react-hooks@7.1.1` |
| `exhaustive-deps` | `__tests__/ESLintRuleExhaustiveDeps-test.js` | `eslint-plugin-react-hooks@7.1.1` |

## Regenerating

```sh
# 1. Sparse-clone the upstream test files at the pinned tag.
mkdir -p /tmp/eslint-plugin-react-hooks-src && cd /tmp/eslint-plugin-react-hooks-src
curl -sL "https://github.com/facebook/react/archive/refs/tags/eslint-plugin-react-hooks@7.1.1.tar.gz" -o release.tar.gz
tar xzf release.tar.gz "react-eslint-plugin-react-hooks-7.1.1/packages/eslint-plugin-react-hooks/__tests__"

# 2. Re-extract.
cd <repo-root>
node packages/oxlint-plugin-react-doctor/scripts/extract-react-hooks-tests.mjs \
  /tmp/eslint-plugin-react-hooks-src/react-eslint-plugin-react-hooks-7.1.1/packages/eslint-plugin-react-hooks/__tests__/ESLintRulesOfHooks-test.js \
  packages/oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/__upstream-fixtures__/rules-of-hooks.json

node packages/oxlint-plugin-react-doctor/scripts/extract-react-hooks-tests.mjs \
  /tmp/eslint-plugin-react-hooks-src/react-eslint-plugin-react-hooks-7.1.1/packages/eslint-plugin-react-hooks/__tests__/ESLintRuleExhaustiveDeps-test.js \
  packages/oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/__upstream-fixtures__/exhaustive-deps.json
```

The extractor sets `process.env.CI=1` inside its sandbox to skip
upstream's `if (!process.env.CI) { ...filter by skip/only... }` block,
preserving every case the upstream test suite asserts (regardless of
its `skip` flag — the skip flag is captured into the JSON for the
parity runner to honor).

## What's NOT in this directory

The 16 React-Compiler-backed rules `eslint-plugin-react-hooks` ships
(`set-state-in-render`, `immutability`, `refs`, `purity`, `hooks`,
`set-state-in-effect`, `globals`, `error-boundaries`,
`preserve-manual-memoization`, `unsupported-syntax`,
`component-hook-factories`, `static-components`, `use-memo`,
`void-use-memo`, `incompatible-library`, `todo`) are runtime wrappers
over `babel-plugin-react-compiler`'s HIR-based analyzer. They aren't
portable to a visitor-only TypeScript plugin without re-implementing
React Compiler. We continue to delegate them to the npm package via
`react-doctor`'s optional peer dep — see `packages/core/src/runners/oxlint/plugin-resolution.ts`.
