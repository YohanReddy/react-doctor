# React Doctor

React Doctor inspects React projects with a small runtime, native codebase analysis, and a curated oxlint rule set.

The package exposes:

- A `react-doctor` CLI for local and CI scans.
- A typed SDK through `react-doctor`.
- Compatibility APIs through `react-doctor/api`.
- Reusable lint integrations through `react-doctor/oxlint-plugin` and `react-doctor/eslint-plugin`.

## CLI

```bash
react-doctor [directory]
```

By default the CLI runs:

- native project structure and codebase graph checks
- oxlint with the React Doctor custom plugin
- scoring and grouped human output

Useful flags:

```bash
react-doctor apps/web --json
react-doctor apps/web --json --json-compact
react-doctor apps/web --no-lint
react-doctor apps/web --no-dead-code
react-doctor apps/web --custom-rules-only
react-doctor apps/web --staged
react-doctor apps/web --unstaged
react-doctor apps/web --changed
react-doctor apps/web --diff main
react-doctor apps/web --offline
react-doctor apps/web --fail-on error
```

Changed-file modes only inspect matching source files: `--staged` for the git index, `--unstaged` for unstaged and untracked files, `--changed` for everything changed since `HEAD`, and `--diff [base]` for a branch comparison. If no changed source files are found, source checks are skipped instead of falling back to a full scan.

## Configuration

React Doctor looks for configuration in:

- `react-doctor.config.json`
- `package.json#reactDoctor`

Config lookup starts at the requested directory and walks ancestors until a project boundary. `rootDir` is resolved relative to the config source, not the current working directory.

```json
{
  "rootDir": "apps/web",
  "lint": true,
  "deadCode": true,
  "customRulesOnly": false,
  "offline": true,
  "failOn": "error",
  "respectInlineDisables": true,
  "adoptExistingLintConfig": false,
  "includeEcosystemRules": true,
  "ignoredTags": ["design"],
  "textComponents": ["Trans"],
  "rawTextWrapperComponents": ["Button"],
  "ignore": {
    "rules": ["react-doctor/no-gradient-text"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["src/legacy/**"],
        "rules": ["react-doctor/no-default-props"]
      }
    ]
  }
}
```

Supported `failOn` values are `error`, `warning`, and `none`.

For React Native, `textComponents` marks custom components that behave like `<Text>`, while `rawTextWrapperComponents` marks components that safely wrap string-only children in text internally.

## SDK

```ts
import { createReactDoctor, inspectReactProject } from "react-doctor";

const result = await inspectReactProject({
  rootDirectory: "apps/web",
  lint: true,
  deadCode: true,
});

const reactDoctor = createReactDoctor({ rootDirectory: "apps/web" });
const nextResult = await reactDoctor.inspect();
```

The result includes project metadata, check results, normalized issues, score, and timing.

```ts
import { buildReactDoctorJsonReport } from "react-doctor";

const report = buildReactDoctorJsonReport(result);
```

Typed runtime errors are exported from the main SDK:

```ts
import { ReactDoctorInvalidConfigError, isReactDoctorError } from "react-doctor";
```

## Lint Integrations

Oxlint users can import the custom plugin:

```js
import reactDoctorOxlintPlugin from "react-doctor/oxlint-plugin";

export default {
  jsPlugins: [reactDoctorOxlintPlugin],
  rules: {
    "react-doctor/no-fetch-in-effect": "warn",
  },
};
```

ESLint users can import the wrapper plugin:

```js
import reactDoctor from "react-doctor/eslint-plugin";

export default [
  {
    plugins: {
      "react-doctor": reactDoctor,
    },
    rules: {
      "react-doctor/no-fetch-in-effect": "warn",
    },
  },
];
```

The ESLint wrapper reuses the same rule implementations and metadata as the oxlint plugin.

## Compatibility API

Deprecated compatibility APIs live under `react-doctor/api` and are intentionally isolated from the main runtime.

```ts
import { diagnose, clearCaches } from "react-doctor/api";

const result = await diagnose("apps/web", {
  lint: true,
  deadCode: true,
});

clearCaches();
```

Prefer `createReactDoctor()` or `inspectReactProject()` for new integrations.

## Development

Run package checks from the package directory:

```bash
nr typecheck
nr test
nr build
```

Run workspace formatting and linting from the repository root:

```bash
nr format:check packages/react-doctor/src packages/react-doctor/tests
nr lint packages/react-doctor/src packages/react-doctor/tests
```
