---
"@react-doctor/core": minor
"@react-doctor/types": minor
"react-doctor": minor
---

Add dead-code analysis powered by [`deslop-js`](https://www.npmjs.com/package/deslop-js).

Findings appear under a new **Dead Code** category and follow the same surface
and severity controls as every other rule:

- `deslop/unused-file` — a source file that is not reachable from any detected entry point.
- `deslop/unused-export` / `deslop/unused-type` — an exported symbol (or type-only symbol) that no other module imports.
- `deslop/unused-dependency` / `deslop/unused-dev-dependency` — a `package.json` dependency that is never imported.
- `deslop/circular-dependency` — an import cycle between two or more files.

Controls:

- `--no-dead-code` (CLI flag) or `"deadCode": false` (config) skips the analysis entirely.
- `"rules": { "deslop/unused-export": "off" }` silences an individual rule.
- `"categories": { "Dead Code": "off" }` silences the whole category.

Dead-code analysis is automatically skipped in `--diff` / `--staged` modes
because reachability is a whole-project property — a diff scan cannot tell
whether a deleted importer just stopped using a file or whether the file
became unreachable.
