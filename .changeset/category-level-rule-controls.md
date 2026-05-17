---
"@react-doctor/core": minor
"oxlint-plugin-react-doctor": minor
"react-doctor": minor
"@react-doctor/types": minor
---

Add category-level rule controls in the exact ESLint / oxlint config
shape — top-level `rules`, `categories`, and `tags` severity maps
with `"error" | "warn" | "off"` values.

- New top-level `rules` field on `ReactDoctorConfig` — same field
  name, same shape, same value form ESLint's `.eslintrc.json` and
  flat config use. Keyed by `"<plugin>/<rule>"`.
- New top-level `categories` field — mirrors oxlint's `categories`
  field, keyed by React Doctor's display categories (`"Server"`,
  `"React Native"`, `"Architecture"`, `"State & Effects"`, …).
- New top-level `tags` field — React Doctor extension on top of the
  ESLint / oxlint surface, same Record-of-severity shape, keyed by
  behavioral tag.
- Precedence (most specific wins): `rules` > `categories` > `tags`.
  When multiple tags match the same rule, the most permissive value
  wins (`"off"` > `"warn"` > `"error"`).
- `"off"` skips registration in the generated oxlint config, so the
  rule never runs and never reaches any surface. `"warn"` / `"error"`
  re-stamp the registered severity and the post-lint diagnostic so
  `--fail-on`, the score, and the printed list all see the user-chosen
  level — including for external-plugin rules (`react/*`,
  `jsx-a11y/*`) whose severities the lint config can't reach.
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
while keeping it on the CLI; use `rules` / `categories` / `tags`
when you want a single value applied across CLI, PR comment, score,
and CI failure at once.
