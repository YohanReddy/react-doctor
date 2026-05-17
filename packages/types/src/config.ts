export type FailOnLevel = "error" | "warning" | "none";

export interface ReactDoctorIgnoreOverride {
  files: string[];
  rules?: string[];
}

interface ReactDoctorIgnoreConfig {
  rules?: string[];
  files?: string[];
  overrides?: ReactDoctorIgnoreOverride[];
  tags?: string[];
}

/**
 * Discrete output channels a diagnostic can flow through after a scan.
 * Each surface is filtered independently so a rule can be visible
 * locally but excluded from PR comments, the score, or the CI gate:
 *
 * - `cli` — local terminal output from `react-doctor` (`printDiagnostics`).
 * - `prComment` — output captured by the GitHub Action for the sticky
 *   PR comment. Enabled when the CLI is run with `--pr-comment` (the
 *   action sets this automatically when `github-token` is provided).
 * - `score` — diagnostics shipped to the React Doctor score API
 *   (or counted toward local score calculations).
 * - `ciFailure` — diagnostics that count toward the `--fail-on` exit
 *   code gate. A diagnostic excluded from this surface never fails the
 *   build, regardless of severity.
 *
 * Defaults: design rules (tag `"design"`) are excluded from `prComment`,
 * `score`, and `ciFailure` so style cleanup doesn't dilute meaningful
 * React findings. They remain in `cli` so locally-running developers
 * still see the suggestion when they touch the file.
 */
export type DiagnosticSurface = "cli" | "prComment" | "score" | "ciFailure";

/**
 * Severity value accepted by `severity` config entries. Mirrors the
 * ESLint / oxlint `"error" | "warn" | "off"` form. `"off"` skips
 * registration entirely so the rule never runs (and therefore
 * never enters any surface); `"error"` / `"warn"` change the
 * rule's registered severity.
 *
 * Use `"off"` to silence a whole rule family at the source. For
 * visibility-only adjustments (silence on PR comments but keep on
 * CLI / score), prefer `surfaces` instead — `severity` applies
 * before lint runs and is the most aggressive control.
 */
export type RuleSeverityOverride = "error" | "warn" | "off";

/**
 * Group-aware severity controls. Mirrors oxlint's top-level `rules`
 * and `categories` fields, plus an additional `tags` channel for
 * the behavioral tags React Doctor attaches to rule families.
 *
 * - `rules` — by fully-qualified rule key (`"<plugin>/<rule>"`,
 *   e.g. `"react-doctor/no-array-index-as-key"`). Most specific.
 * - `categories` — by category label (e.g. `"Server"`,
 *   `"React Native"`, `"Architecture"`). Affects every rule in
 *   that category.
 * - `tags` — by behavioral tag (e.g. `"design"`, `"test-noise"`,
 *   `"react-native"`, `"server-action"`, `"migration-hint"`).
 *   Affects every rule that carries the tag.
 *
 * Precedence (most specific wins): `rules` > `categories` > `tags`.
 * Within the tag channel, when multiple tags match the same rule,
 * the *most permissive* value wins (`"off"` over `"warn"` over
 * `"error"`) so silencing via any matching tag is always honored.
 */
export interface RuleSeverityControls {
  rules?: Record<string, RuleSeverityOverride>;
  categories?: Record<string, RuleSeverityOverride>;
  tags?: Record<string, RuleSeverityOverride>;
}

export interface SurfaceControls {
  /**
   * Tag names whose diagnostics should be force-included on the surface,
   * even if a default or category-level exclusion would otherwise drop
   * them. Include wins over exclude when both apply to the same rule.
   */
  includeTags?: string[];
  /**
   * Tag names whose diagnostics should be excluded from the surface.
   * Use this to silence whole rule families (e.g. `["design"]`,
   * `["test-noise"]`) for a single channel without touching others.
   */
  excludeTags?: string[];
  /** Category names (e.g. `"Architecture"`) to force-include. */
  includeCategories?: string[];
  /** Category names (e.g. `"Architecture"`) to exclude. */
  excludeCategories?: string[];
  /**
   * Fully-qualified rule keys (`"<plugin>/<rule>"`, e.g.
   * `"react-doctor/design-no-redundant-size-axes"`) to force-include.
   */
  includeRules?: string[];
  /** Fully-qualified rule keys to exclude from this surface. */
  excludeRules?: string[];
}

export interface ReactDoctorConfig {
  ignore?: ReactDoctorIgnoreConfig;
  lint?: boolean;
  verbose?: boolean;
  diff?: boolean | string;
  failOn?: FailOnLevel;
  customRulesOnly?: boolean;
  share?: boolean;
  offline?: boolean;
  /**
   * Redirect react-doctor at a different project directory than the one
   * it was invoked against. Resolved relative to the location of the
   * config file that declared this field (NOT relative to the CWD), so
   * the redirect is stable no matter where the CLI / `diagnose()` is
   * run from. Absolute paths are used as-is.
   *
   * Typical use: a monorepo root holds the only `react-doctor.config.json`
   * (so editor tooling and child commands all find it), but the React
   * app lives in `apps/web`. Setting `"rootDir": "apps/web"` makes
   * every invocation that loads this config scan that subproject
   * without anyone needing to `cd` first or pass an explicit path.
   *
   * Ignored if the resolved path does not exist or is not a directory
   * (a warning is emitted and react-doctor falls back to the originally
   * requested directory).
   */
  rootDir?: string;
  textComponents?: string[];
  /**
   * Names of components that safely route string-only children through a
   * React Native `<Text>` internally (e.g. `heroui-native`'s `Button`,
   * which stringifies its children and renders them through a
   * `ButtonLabel` → `Text`). For listed components, `rn-no-raw-text`
   * is suppressed ONLY when the wrapper's children are entirely
   * stringifiable (no nested JSX elements). A wrapper with mixed
   * children — e.g. `<Button>Save<Icon /></Button>` — still reports,
   * because the wrapper can't safely route raw text alongside a
   * sibling JSX element.
   *
   * Use this instead of `textComponents` when the component is not
   * itself a text element but is known to wrap its string children
   * in one. `textComponents` is the broader escape hatch and
   * suppresses regardless of sibling content.
   */
  rawTextWrapperComponents?: string[];
  /**
   * Project-level allowlist of function names that the
   * `server-auth-actions` rule treats as an auth check at the top of
   * a server action. Names are accepted whether called as a bare
   * identifier (`myAuthGuard()`) or as the final property of a
   * member call (`ctx.myAuthGuard()`); unlike the built-in default
   * list, user-provided names are treated as distinctive and never
   * subject to receiver-object disambiguation.
   *
   * Use this to teach react-doctor about custom auth guards in
   * codebases that wrap their auth library — e.g. a project-local
   * `requireWorkspaceMember` or `ensureSignedIn`.
   */
  serverAuthFunctionNames?: string[];
  /**
   * Whether to respect inline `// eslint-disable*`, `// oxlint-disable*`,
   * and `// react-doctor-disable*` comments in source files. Default: `true`.
   *
   * File-level ignores (`.gitignore`, `.eslintignore`, `.oxlintignore`,
   * `.prettierignore`, `.gitattributes` `linguist-vendored` /
   * `linguist-generated`) are ALWAYS honored regardless of this option
   * — they typically point at vendored or generated code that
   * genuinely shouldn't be linted at all.
   *
   * Set to `false` for "audit mode": every inline suppression is
   * neutralized so react-doctor reports every diagnostic regardless
   * of historical hide-comments.
   */
  respectInlineDisables?: boolean;
  /**
   * Whether to merge the user's existing JSON oxlint / eslint config
   * (`.oxlintrc.json` or `.eslintrc.json`) into the generated scan via
   * oxlint's `extends` field, so diagnostics from those rules count
   * toward the react-doctor score. Default: `true`.
   *
   * Detection runs at the scanned directory and walks up to the
   * nearest project boundary (`.git` directory or monorepo root).
   * The first match wins, with `.oxlintrc.json` preferred over
   * `.eslintrc.json`.
   *
   * Only JSON-format configs are supported because oxlint's `extends`
   * cannot evaluate JS/TS configs. Flat configs (`eslint.config.js`),
   * legacy JS configs (`.eslintrc.js`), and TypeScript oxlint configs
   * (`oxlint.config.ts`) are silently skipped.
   *
   * Category-level enables in the user's config (`"categories": { ... }`)
   * are NOT honored — react-doctor explicitly disables every oxlint
   * category to keep the scan scoped to its curated rule surface, and
   * local config wins over `extends`. Use rule-level severities to
   * fold rules into the score.
   *
   * Set to `false` to scan only react-doctor's curated rule set.
   */
  adoptExistingLintConfig?: boolean;
  /**
   * Per-surface include/exclude controls. Each `DiagnosticSurface` is
   * resolved independently against rule tags, category, and id so a
   * single rule can be visible locally yet hidden from PR comments,
   * neutralized from the score, and excluded from `--fail-on` — all
   * without touching the rule's severity or activation.
   *
   * Defaults (applied before user overrides):
   *
   * - `prComment` excludes tag `"design"`
   * - `score` excludes tag `"design"`
   * - `ciFailure` excludes tag `"design"`
   *
   * Pass any controls block (even an empty `{}`) to keep the default
   * exclusions; the user's include/exclude entries layer on top.
   * Include entries always win over exclude entries — handy for
   * promoting a single high-signal `design-*` rule back into the
   * score or PR-comment surface.
   */
  surfaces?: Partial<Record<DiagnosticSurface, SurfaceControls>>;
  /**
   * Per-rule, per-category, and per-tag severity controls applied
   * at lint registration time. The React Doctor analogue of ESLint's
   * `rules: { ... }` and oxlint's `rules: { ... }` + `categories: { ... }`,
   * extended with a `tags` channel for behavioral families.
   *
   * Example: demote every React Native rule to a warning, silence
   * the design family entirely, and promote one specific rule to
   * an error:
   *
   * ```json
   * {
   *   "severity": {
   *     "tags": { "react-native": "warn", "design": "off" },
   *     "rules": { "react-doctor/no-array-index-as-key": "error" }
   *   }
   * }
   * ```
   *
   * Precedence: `rules` > `categories` > `tags`. Use this when you
   * want to remove a rule from every channel (CLI, PR comment, score,
   * CI failure) at once. For visibility-only changes, use `surfaces`.
   */
  severity?: RuleSeverityControls;
}
