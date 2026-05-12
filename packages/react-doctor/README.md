<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Your agent writes bad React, this catches it.

React Doctor scans React projects with native codebase analysis, a curated oxlint rule set, and actionable diagnostics.

Works with React, Next.js, React Native, Expo, TanStack Start, and common React ecosystem libraries.

### [See it in action](https://react.doctor)

## Run

Run this at your project root:

```bash
npx -y react-doctor@latest .
```

By default React Doctor runs:

- native project structure and codebase graph checks
- oxlint with the React Doctor custom plugin
- scoring and grouped human output

You get a 0 to 100 score and a list of issues across state and effects, performance, architecture, security, accessibility, framework usage, dependencies, and dead code. Rules toggle automatically based on your framework, React version, and detected libraries.

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## React Doctor Skill

React Doctor also ships as an agent Skill. The CLI catches problems after code is written; the Skill teaches your coding agent the same React, framework, and performance guidance before it writes the next patch.

```bash
npx -y react-doctor@latest install
```

Use the Skill when you want agents to:

- avoid common state and effect mistakes
- choose framework-native APIs for Next.js, React Native, Expo, and TanStack Start
- keep rendering, animation, data fetching, and accessibility choices high-signal
- understand React Doctor diagnostics and fix the underlying issue instead of hiding it

The installer detects supported coding agents and prompts you to choose where to install the Skill. Pass `--yes` to accept the default detected targets.

## CLI

```bash
react-doctor [directory]
```

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

Changed-file modes only inspect matching source files:

- `--staged` scans the git index for pre-commit flows.
- `--unstaged` scans unstaged and untracked source files.
- `--changed` scans staged, unstaged, and untracked source files since `HEAD`.
- `--diff [base]` scans files changed against a base branch, defaulting to `main`.

If no changed source files are found, source checks are skipped instead of falling back to a full scan.

`--fail-on` accepts `error`, `warning`, or `none`.

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
  "adoptExistingLintConfig": true,
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

Pick the narrowest ignore that fits:

- **`ignore.rules`** silences a rule across the codebase.
- **`ignore.files`** silences every rule on matched files.
- **`ignore.overrides`** silences only the listed rules on the matched files, leaving every other rule active. This is what you want when a single file (or glob) legitimately needs an exemption from one or two rules but should still be scanned for everything else.

React Doctor can adopt the first JSON `.oxlintrc.json` or `.eslintrc.json` found while walking ancestors. Set `adoptExistingLintConfig` to `false` to scan only React Doctor rules.

`ignoredTags` lets you trim noisy categories without turning the whole scanner off. For example, `["design"]` keeps structural React checks while skipping subjective visual style suggestions.

For React Native, `textComponents` marks custom components that behave like `<Text>`, while `rawTextWrapperComponents` marks components that safely wrap string-only children in text internally.

## Scoring

Scores are a simple health signal, not a moral judgment. React Doctor starts at 100, subtracts more for error-level rule families than warning-level families, and counts a repeated rule once so one noisy pattern does not dominate the whole project.

The score can move between releases as rules become more precise, new framework rules are added, or noisy checks are demoted. Treat the detailed diagnostics as the source of truth and use the score for trend tracking across repeated runs.

### Inline suppressions

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
}, [value]);
```

When two rules fire on the same line, you have two equivalent options. Comma-separate the rule ids on a single comment:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers, react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

Or stack one comment per rule directly above the diagnostic:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers
// react-doctor-disable-next-line react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

Block comments work inside JSX:

<!-- prettier-ignore -->
```tsx
{/* react-doctor-disable-next-line react/no-danger */}
<div dangerouslySetInnerHTML={{ __html }} />
```

For multi-line JSX, putting the comment immediately above the opening tag covers the entire attribute list (matching ESLint convention).

## Lint Integrations

The same rule set ships as both an oxlint plugin and an ESLint plugin, so you can wire it into whichever lint engine your project already runs.

Oxlint:

```js
import reactDoctorOxlintPlugin from "react-doctor/oxlint-plugin";

export default {
  jsPlugins: [reactDoctorOxlintPlugin],
  rules: {
    "react-doctor/no-fetch-in-effect": "warn",
  },
};
```

ESLint:

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

## Leaderboard

Top React codebases scanned by React Doctor, ranked by score. Updated automatically from [millionco/react-doctor-benchmarks](https://github.com/millionco/react-doctor-benchmarks).

<!-- LEADERBOARD:START -->
<!-- prettier-ignore -->
| #  | Repo | Score |
| -- | ---- | ----: |
| 1  | [executor](https://github.com/RhysSullivan/executor) | 94 |
| 2  | [nodejs.org](https://github.com/nodejs/nodejs.org) | 86 |
| 3  | [tldraw](https://github.com/tldraw/tldraw) | 70 |
| 4  | [t3code](https://github.com/pingdotgg/t3code) | 68 |
| 5  | [better-auth](https://github.com/better-auth/better-auth) | 64 |
| 6  | [excalidraw](https://github.com/excalidraw/excalidraw) | 63 |
| 7  | [mastra](https://github.com/mastra-ai/mastra) | 63 |
| 8  | [payload](https://github.com/payloadcms/payload) | 60 |
| 9  | [typebot](https://github.com/baptisteArno/typebot.io) | 57 |
| 10 | [plane](https://github.com/makeplane/plane) | 56 |

<!-- LEADERBOARD:END -->

See the [full leaderboard](https://www.react.doctor/leaderboard).

## Resources & Contributing Back

Want to try it out? Check out [the demo](https://react.doctor).

Looking to contribute back? Clone the repo, install, build, and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
ni
nr build
node packages/react-doctor/bin/react-doctor.js apps/web
```

Find a bug? Head to the [issue tracker](https://github.com/millionco/react-doctor/issues).

Release notes are published on [GitHub Releases](https://github.com/millionco/react-doctor/releases).

### License

React Doctor is MIT-licensed open-source software.
