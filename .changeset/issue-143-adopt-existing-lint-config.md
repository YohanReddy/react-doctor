---
"react-doctor": minor
---

feat(react-doctor): adopt the project's existing oxlint / eslint config and factor those rules into the score

When a project has a JSON-format oxlint or eslint config (`.oxlintrc.json`
or `.eslintrc.json`) at the scanned directory or any ancestor up to the
nearest project boundary (`.git` directory or monorepo root),
react-doctor now folds that config into the same scan via oxlint's
`extends` field. The user's existing rules fire alongside the curated
react-doctor rule set, and the resulting diagnostics count toward the
0–100 health score — no separate `oxlint` / `eslint` invocation needed.

**Behavior change on upgrade.** Projects with an existing
`.oxlintrc.json` / `.eslintrc.json` will see new diagnostics flow into
the score on first run; the score may drop. Set
`"adoptExistingLintConfig": false` in `react-doctor.config.json` (or the
`"reactDoctor"` key in `package.json`) to preserve the previous
behavior. `customRulesOnly: true` also implies opt-out, since that mode
runs only the `react-doctor/*` plugin.

**Resilience.** If oxlint can't load the user's config (broken JSON,
missing plugin, unknown rule name), react-doctor logs the reason on
stderr and retries the scan once without `extends` so the score is
still computed off the curated rule set instead of failing the whole
lint pass.

**Coverage broadened.** Diagnostics on `.ts` and `.js` files are now
reported (previously the parser dropped everything that wasn't `.tsx`
/ `.jsx`). This affects react-doctor's own JS-performance / bundle-size
rules in addition to adopted user rules.

**Limitations.** Only JSON configs are picked up: oxlint's `extends`
cannot evaluate JS or TS, so flat configs (`eslint.config.js`),
`.eslintrc.{js,cjs}`, and `oxlint.config.ts` are silently skipped.
Rule-level severities (`"rules": {...}`) flow through, but
category-level enables (`"categories": {...}`) do not — react-doctor's
local categories block always wins. Closes #143.
