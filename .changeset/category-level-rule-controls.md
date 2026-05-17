---
"@react-doctor/core": minor
"oxlint-plugin-react-doctor": minor
"react-doctor": minor
"@react-doctor/types": minor
---

Add category-level rule controls: per-rule, per-category, and per-tag
severity, applied at lint registration time. The React Doctor analogue
of ESLint's `rules: { ... }` and oxlint's `rules: { ... }` +
`categories: { ... }`.

- New `severity` config field on `ReactDoctorConfig` accepting
  `rules`, `categories`, and `tags` channels. Values are `"error"`,
  `"warn"`, or `"off"` — the same form ESLint and oxlint accept.
  Precedence: `rules` > `categories` > `tags`; when multiple tags
  match the same rule, the most permissive value wins
  (`"off"` > `"warn"` > `"error"`).
- `"off"` skips registration in the generated oxlint config, so the
  rule never runs and never reaches any surface. `"warn"` / `"error"`
  re-stamp the registered severity and the post-lint diagnostic so
  `--fail-on`, the score, and the printed list all see the user-chosen
  level — including for external-plugin rules (`react/*`,
  `jsx-a11y/*`) whose severities the surface controls couldn't reach.
- Added bucket-derived auto-tags so cross-cutting controls can target
  whole rule families without each rule repeating the tag:
  - every rule in the `react-native/` bucket now carries
    `"react-native"`;
  - every rule in the `server/` bucket now carries `"server-action"`;
  - `no-react19-deprecated-apis`, `no-react-dom-deprecated-apis`,
    `no-legacy-class-lifecycles`, and `no-legacy-context-api` now
    carry `"migration-hint"`.

Composes with the existing `surfaces` controls — use `surfaces` when
you only want to hide a rule from one channel (e.g. PR comments)
while keeping it on the CLI; use `severity` when you want a single
value applied across CLI, PR comment, score, and CI failure at once.
