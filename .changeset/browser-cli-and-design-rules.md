---
"react-doctor": patch
"react-doctor-browser": patch
---

feat(react-doctor): add `browser` CLI subcommand and 11 new lint rules

**New `react-doctor-browser` package** wraps Playwright + CDP for headless
automation, system Chrome launching, ARIA snapshots, and cross-browser
cookie extraction (Chromium SQLite, Firefox, Safari binarycookies).

**New `react-doctor browser …` CLI** with a long-running session model
persisted at `~/.react-doctor/browser.json`:

- `start [url]` / `stop` / `status`
- `snapshot [url]` — ARIA tree (text or JSON)
- `screenshot [url]` — PNG/JPEG, viewport or full-page, optional selector
- `playwright [url] --eval "…"` — evaluate a JS snippet with `page`,
  `browser`, and `context` in scope (also reads stdin)

The session reconnects over CDP across invocations; `stop` sends SIGTERM
with a 2-second grace period before escalating to SIGKILL so we never
leak a zombie Chrome holding the CDP port.

**3 new state / correctness rules** (all `warn`):

- `no-direct-state-mutation` — flags `state.foo = x` and in-place array
  mutators (`push`/`pop`/`shift`/`unshift`/`splice`/`sort`/`reverse`/
  `fill`/`copyWithin`) on `useState` values. Tracks shadowed names
  through nested function params and locals so a handler that re-binds
  the state name doesn't false-positive.
- `no-set-state-in-render` — flags only **unconditional** top-level
  setter calls so the canonical `if (prev !== prop) setPrev(prop)`
  derive-from-props pattern stays clean.
- `no-uncontrolled-input` — catches `<input value={…}>` without
  `onChange` / `readOnly`, `value` + `defaultValue` conflicts, and
  `useState()` flip-from-undefined. Bails on JSX spread props
  (`{...register(…)}`, Headless UI, Radix) where `onChange` may come
  from spread.

**8 new design-system rules in a new `react-ui.ts`** (all `warn`):

- `design-no-bold-heading` — `font-bold`/`font-extrabold`/`font-black`
  or inline `fontWeight ≥ 700` on `h1`–`h6`
- `design-no-redundant-padding-axes` — collapse `px-N py-N` → `p-N`
- `design-no-redundant-size-axes` — collapse `w-N h-N` → `size-N`
- `design-no-space-on-flex-children` — use `gap-*` over `space-*-*`
- `design-no-em-dash-in-jsx-text` — em dashes in JSX text
- `design-no-three-period-ellipsis` — `Loading...` → `Loading…`
- `design-no-default-tailwind-palette` — `indigo-*`/`gray-*`/`slate-*`
  reads as Tailwind template default; reports every offending token in
  the className (not just the first)
- `design-no-vague-button-label` — `OK` / `Continue` / `Submit` etc.;
  recurses into `<>…</>` fragment children

Each new rule has dedicated regression tests covering both the
positive trigger and the false-positive cases above.

**Other**

- Hoists shared constants (CDP timeouts, viewport defaults, regex/token
  patterns, session paths) into the appropriate `constants.ts` per
  AGENTS.md; replaces a `JSON.parse(raw) as BrowserSessionState` with a
  proper type guard.
- Bumps a handful of dev-time dependencies (`@types/node`, `typescript`,
  `turbo`, `@changesets/cli`) and adds `playwright` + `react-doctor-browser`
  to `react-doctor`'s deps. Website bumps `next`/`react`/`react-dom`/
  `lucide-react`/`@vercel/analytics`.
