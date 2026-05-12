import { createRequire } from "node:module";
import { reactDoctorOxlintRules } from "./rules.js";

const esmRequire = createRequire(import.meta.url);

export interface OxlintRuleSeverityMap {
  [ruleKey: string]: "error" | "warn" | "off";
}

const REACT_DOCTOR_OXLINT_RULE_KEY_PREFIX = "react-doctor/";
const REACT_HOOKS_JS_NAMESPACE = "react-hooks-js";
const REACT_HOOKS_PLUGIN_SPECIFIER = "eslint-plugin-react-hooks";
const DEFAULT_OXLINT_RULE_SEVERITY: OxlintRuleSeverityMap[string] = "warn";
const NEXTJS_RULE_NAME_PREFIX = "nextjs-";
const TANSTACK_AI_RULE_NAME_PREFIX = "tanstack-ai-";
const TANSTACK_START_RULE_NAME_PREFIX = "tanstack-start-";
const TANSTACK_QUERY_RULE_NAME_PREFIX = "query-";
const REACT_NATIVE_RULE_NAME_PREFIXES: ReadonlyArray<string> = ["expo-", "rn-"];
const ECOSYSTEM_RULE_NAME_PREFIXES: ReadonlyArray<string> = [
  "tailwind-",
  "motion-",
  "swr-",
  "mobx-",
  "i18n-",
  "shadcn-",
  "radix-",
  "rhf-",
  "testing-",
  "storybook-",
  "r3f-",
];

const REACT_DOCTOR_ERROR_RULE_NAMES: ReadonlySet<string> = new Set([
  "nextjs-async-client-component",
  "nextjs-no-head-import",
  "nextjs-no-side-effect-in-get-handler",
  "rn-no-raw-text",
  "rn-no-deprecated-modules",
  "rn-no-scroll-state",
  "rn-animate-layout-property",
  "tanstack-start-route-property-order",
  "tanstack-start-server-fn-method-order",
  "tanstack-start-no-dynamic-server-fn-import",
  "tanstack-start-no-use-server-in-handler",
  "tanstack-start-no-secrets-in-loader",
  "query-no-unstable-query-key",
  "tailwind-oklch-alpha-syntax",
  "swr-no-unstable-key",
  "radix-aschild-single-child",
  "testing-await-user-event",
  "storybook-await-play-interactions",
  "r3f-no-new-in-frame",
  "r3f-no-clone-in-frame",
  "no-mutable-in-deps",
  "no-effect-event-in-deps",
  "rerender-dependencies",
  "effect-needs-cleanup",
  "no-random-key",
  "no-nested-component-definition",
  "no-legacy-class-lifecycles",
  "no-legacy-context-api",
  "no-layout-property-animation",
  "no-global-css-variable-animation",
  "no-eval",
  "server-auth-actions",
  "server-no-mutable-module-state",
  "no-disabled-zoom",
]);

export const REACT_COMPILER_OXLINT_RULES: OxlintRuleSeverityMap = {
  "react-hooks-js/set-state-in-render": "error",
  "react-hooks-js/immutability": "error",
  "react-hooks-js/refs": "error",
  "react-hooks-js/purity": "error",
  "react-hooks-js/hooks": "error",
  "react-hooks-js/set-state-in-effect": "error",
  "react-hooks-js/globals": "error",
  "react-hooks-js/error-boundaries": "error",
  "react-hooks-js/preserve-manual-memoization": "error",
  "react-hooks-js/unsupported-syntax": "error",
  "react-hooks-js/component-hook-factories": "error",
  "react-hooks-js/static-components": "error",
  "react-hooks-js/use-memo": "error",
  "react-hooks-js/void-use-memo": "error",
  "react-hooks-js/incompatible-library": "error",
  "react-hooks-js/todo": "error",
};

export const BUILTIN_REACT_OXLINT_RULES: OxlintRuleSeverityMap = {
  "react/rules-of-hooks": "error",
  "react/exhaustive-deps": "warn",
  "react/no-direct-mutation-state": "error",
  "react/jsx-no-duplicate-props": "error",
  "react/jsx-key": "error",
  "react/no-children-prop": "warn",
  "react/no-danger": "warn",
  "react/jsx-no-script-url": "error",
  "react/no-render-return-value": "warn",
  "react/no-string-refs": "warn",
  "react/no-is-mounted": "warn",
  "react/require-render-return": "error",
  "react/no-unknown-property": "warn",
};

export const BUILTIN_A11Y_OXLINT_RULES: OxlintRuleSeverityMap = {
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-is-valid": "warn",
  "jsx-a11y/click-events-have-key-events": "warn",
  "jsx-a11y/no-static-element-interactions": "warn",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/no-autofocus": "warn",
  "jsx-a11y/heading-has-content": "warn",
  "jsx-a11y/html-has-lang": "warn",
  "jsx-a11y/no-redundant-roles": "warn",
  "jsx-a11y/scope": "warn",
  "jsx-a11y/tabindex-no-positive": "warn",
  "jsx-a11y/label-has-associated-control": "warn",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/iframe-has-title": "warn",
};

export const BUILTIN_OXLINT_RULES: OxlintRuleSeverityMap = {
  ...BUILTIN_REACT_OXLINT_RULES,
  ...BUILTIN_A11Y_OXLINT_RULES,
};

const startsWithAny = (value: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.some((prefix) => value.startsWith(prefix));

const toReactDoctorOxlintRuleKey = (ruleName: string): string =>
  `${REACT_DOCTOR_OXLINT_RULE_KEY_PREFIX}${ruleName}`;

const getReactDoctorRuleSeverity = (ruleName: string): OxlintRuleSeverityMap[string] =>
  REACT_DOCTOR_ERROR_RULE_NAMES.has(ruleName) ? "error" : DEFAULT_OXLINT_RULE_SEVERITY;

const createReactDoctorRuleMap = (
  shouldIncludeRule: (ruleName: string) => boolean,
): OxlintRuleSeverityMap => {
  const rules: OxlintRuleSeverityMap = {};
  for (const ruleName of Object.keys(reactDoctorOxlintRules)) {
    if (shouldIncludeRule(ruleName)) {
      rules[toReactDoctorOxlintRuleKey(ruleName)] = getReactDoctorRuleSeverity(ruleName);
    }
  }
  return rules;
};

const isNextJsRuleName = (ruleName: string): boolean =>
  ruleName.startsWith(NEXTJS_RULE_NAME_PREFIX);

const isReactNativeRuleName = (ruleName: string): boolean =>
  startsWithAny(ruleName, REACT_NATIVE_RULE_NAME_PREFIXES);

const isTanStackAiRuleName = (ruleName: string): boolean =>
  ruleName.startsWith(TANSTACK_AI_RULE_NAME_PREFIX);

const isTanStackStartRuleName = (ruleName: string): boolean =>
  ruleName.startsWith(TANSTACK_START_RULE_NAME_PREFIX);

const isTanStackQueryRuleName = (ruleName: string): boolean =>
  ruleName.startsWith(TANSTACK_QUERY_RULE_NAME_PREFIX);

const isEcosystemRuleName = (ruleName: string): boolean =>
  startsWithAny(ruleName, ECOSYSTEM_RULE_NAME_PREFIXES);

const isFrameworkRuleName = (ruleName: string): boolean =>
  isNextJsRuleName(ruleName) ||
  isReactNativeRuleName(ruleName) ||
  isTanStackAiRuleName(ruleName) ||
  isTanStackStartRuleName(ruleName) ||
  isTanStackQueryRuleName(ruleName);

export const NEXTJS_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isNextJsRuleName);

export const REACT_NATIVE_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isReactNativeRuleName);

export const TANSTACK_START_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isTanStackStartRuleName);

export const TANSTACK_AI_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isTanStackAiRuleName);

export const TANSTACK_QUERY_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isTanStackQueryRuleName);

export const ECOSYSTEM_OXLINT_RULES: OxlintRuleSeverityMap =
  createReactDoctorRuleMap(isEcosystemRuleName);

export const GLOBAL_REACT_DOCTOR_OXLINT_RULES: OxlintRuleSeverityMap = createReactDoctorRuleMap(
  (ruleName) => !isFrameworkRuleName(ruleName) && !isEcosystemRuleName(ruleName),
);

export const REACT_DOCTOR_CUSTOM_OXLINT_RULES: OxlintRuleSeverityMap = {
  ...GLOBAL_REACT_DOCTOR_OXLINT_RULES,
  ...NEXTJS_OXLINT_RULES,
  ...REACT_NATIVE_OXLINT_RULES,
  ...TANSTACK_AI_OXLINT_RULES,
  ...TANSTACK_START_OXLINT_RULES,
  ...TANSTACK_QUERY_OXLINT_RULES,
  ...ECOSYSTEM_OXLINT_RULES,
};

export const CURATED_OXLINT_RULES: OxlintRuleSeverityMap = {
  ...BUILTIN_REACT_OXLINT_RULES,
  ...BUILTIN_A11Y_OXLINT_RULES,
  ...REACT_COMPILER_OXLINT_RULES,
  ...REACT_DOCTOR_CUSTOM_OXLINT_RULES,
};

export const ALL_REACT_DOCTOR_OXLINT_RULE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(REACT_DOCTOR_CUSTOM_OXLINT_RULES),
);

export type ReactDoctorOxlintFramework =
  | "expo"
  | "nextjs"
  | "react"
  | "react-native"
  | "tanstack-start"
  | "unknown";

export interface ReactDoctorOxlintConfigOptions {
  pluginPath: string;
  project?: ReactDoctorOxlintProjectInfo;
  framework?: ReactDoctorOxlintFramework;
  customRulesOnly?: boolean;
  hasReactCompiler?: boolean;
  hasTanStackAI?: boolean;
  hasTanStackQuery?: boolean;
  includeEcosystemRules?: boolean;
  extendsPaths?: string[];
  ignoredTags?: ReadonlySet<string>;
}

export interface ReactDoctorOxlintProjectInfo {
  framework?: ReactDoctorOxlintFramework;
  hasReactCompiler?: boolean;
  hasTanStackAI?: boolean;
  hasTanStackQuery?: boolean;
  hasTypeScript?: boolean;
  reactMajorVersion?: number | null;
  reactPeerDependencyRange?: string | null;
  tailwindVersion?: string | null;
}

export interface ReactDoctorOxlintJsPluginEntry {
  name: string;
  specifier: string;
}

export interface ReactDoctorOxlintGeneratedConfig {
  extends?: string[];
  categories: Record<string, "off">;
  plugins: string[];
  jsPlugins: Array<string | ReactDoctorOxlintJsPluginEntry>;
  rules: OxlintRuleSeverityMap;
}

const DISABLED_OXLINT_CATEGORIES: ReactDoctorOxlintGeneratedConfig["categories"] = {
  correctness: "off",
  nursery: "off",
  pedantic: "off",
  perf: "off",
  restriction: "off",
  style: "off",
  suspicious: "off",
};

interface MaybePluginModule {
  rules?: Record<string, unknown>;
  default?: { rules?: Record<string, unknown> };
}

interface ResolvedPlugin {
  entry: ReactDoctorOxlintJsPluginEntry;
  availableRuleNames: ReadonlySet<string>;
}

interface RuleMetadataEntry {
  requires?: ReadonlyArray<string>;
  tags: ReadonlySet<string>;
}

interface RuleGroupConfig {
  rules: OxlintRuleSeverityMap;
  requires?: ReadonlyArray<string>;
}

const EMPTY_TAGS: ReadonlySet<string> = new Set();
const DEFAULT_IGNORED_TAGS: ReadonlySet<string> = new Set(["pedantic"]);
const TEST_NOISE_TAGS: ReadonlySet<string> = new Set(["test-noise"]);
const PEDANTIC_TAGS: ReadonlySet<string> = new Set(["pedantic"]);
const DESIGN_AND_TEST_NOISE_TAGS: ReadonlySet<string> = new Set(["design", "test-noise"]);
const TAILWIND_VERSION_PATTERN = /(?:^|[^\d])(\d+)(?:\.(\d+))?/;
const PEER_COMPARATOR_SEPARATOR = /[\s,|]+/;
const PEER_WILDCARD_COMPARATOR = /^[*xX](?:\.[*xX])*$/;

const withReactDoctorRuleKey = (
  ruleName: string,
  metadata: RuleMetadataEntry,
): [string, RuleMetadataEntry] => [toReactDoctorOxlintRuleKey(ruleName), metadata];

const RULE_METADATA: ReadonlyMap<string, RuleMetadataEntry> = new Map([
  withReactDoctorRuleKey("no-react19-deprecated-apis", {
    requires: ["react:19"],
    tags: TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("no-default-props", { requires: ["react:19"], tags: TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-react-dom-deprecated-apis", {
    requires: ["react:18"],
    tags: TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("prefer-use-effect-event", {
    requires: ["react:19"],
    tags: TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("design-no-bold-heading", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("design-no-redundant-padding-axes", {
    tags: DESIGN_AND_TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("design-no-redundant-size-axes", {
    requires: ["tailwind:3.4"],
    tags: DESIGN_AND_TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("design-no-space-on-flex-children", {
    tags: DESIGN_AND_TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("design-no-three-period-ellipsis", { tags: PEDANTIC_TAGS }),
  withReactDoctorRuleKey("design-no-default-tailwind-palette", {
    tags: DESIGN_AND_TEST_NOISE_TAGS,
  }),
  withReactDoctorRuleKey("design-no-vague-button-label", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-side-tab-border", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-pure-black-background", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-gradient-text", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-dark-mode-glow", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-justified-text", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-tiny-text", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-wide-letter-spacing", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-gray-on-colored-background", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-layout-transition-inline", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-outline-none", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
  withReactDoctorRuleKey("no-long-transition-duration", { tags: DESIGN_AND_TEST_NOISE_TAGS }),
]);

const REACT_DOCTOR_FRAMEWORK_RULE_GROUPS: ReadonlyArray<RuleGroupConfig> = [
  { rules: NEXTJS_OXLINT_RULES, requires: ["nextjs"] },
  { rules: REACT_NATIVE_OXLINT_RULES, requires: ["react-native"] },
  { rules: TANSTACK_START_OXLINT_RULES, requires: ["tanstack-start"] },
  { rules: TANSTACK_AI_OXLINT_RULES, requires: ["tanstack-ai"] },
  { rules: TANSTACK_QUERY_OXLINT_RULES, requires: ["tanstack-query"] },
];

const readPluginRuleNames = (pluginSpecifier: string): ReadonlySet<string> => {
  try {
    const pluginModule: MaybePluginModule = esmRequire(pluginSpecifier);
    const rules = pluginModule.rules ?? pluginModule.default?.rules;
    return rules ? new Set(Object.keys(rules)) : new Set();
  } catch {
    return new Set();
  }
};

const resolveOptionalJsPlugin = (
  namespace: string,
  pluginSpecifier: string,
): ResolvedPlugin | null => {
  try {
    const resolvedSpecifier = esmRequire.resolve(pluginSpecifier);
    return {
      entry: { name: namespace, specifier: resolvedSpecifier },
      availableRuleNames: readPluginRuleNames(resolvedSpecifier),
    };
  } catch {
    return null;
  }
};

const filterRulesToAvailable = (
  rules: OxlintRuleSeverityMap,
  pluginNamespace: string,
  availableRuleNames: ReadonlySet<string>,
): OxlintRuleSeverityMap => {
  if (availableRuleNames.size === 0) return rules;
  const ruleKeyPrefix = `${pluginNamespace}/`;
  const filteredRules: OxlintRuleSeverityMap = {};
  for (const [ruleKey, severity] of Object.entries(rules)) {
    if (!ruleKey.startsWith(ruleKeyPrefix)) {
      filteredRules[ruleKey] = severity;
      continue;
    }
    const ruleName = ruleKey.slice(ruleKeyPrefix.length);
    if (availableRuleNames.has(ruleName)) {
      filteredRules[ruleKey] = severity;
    }
  }
  return filteredRules;
};

const buildOptionalReactCompilerConfig = (
  customRulesOnly: boolean,
  hasReactCompiler: boolean,
): { jsPlugin: ReactDoctorOxlintJsPluginEntry | null; rules: OxlintRuleSeverityMap } => {
  if (customRulesOnly || !hasReactCompiler) return { jsPlugin: null, rules: {} };
  const plugin = resolveOptionalJsPlugin(REACT_HOOKS_JS_NAMESPACE, REACT_HOOKS_PLUGIN_SPECIFIER);
  if (!plugin) return { jsPlugin: null, rules: {} };
  return {
    jsPlugin: plugin.entry,
    rules: filterRulesToAvailable(
      REACT_COMPILER_OXLINT_RULES,
      REACT_HOOKS_JS_NAMESPACE,
      plugin.availableRuleNames,
    ),
  };
};

const parseMajorMinor = (
  version: string | null | undefined,
): { major: number; minor: number } | null => {
  if (!version) return null;
  const match = version.match(TAILWIND_VERSION_PATTERN);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: match[2] ? Number.parseInt(match[2], 10) : 0,
  };
};

const isTailwindAtLeast = (
  version: { major: number; minor: number } | null,
  minimum: { major: number; minor: number },
): boolean => {
  if (!version) return true;
  if (version.major > minimum.major) return true;
  if (version.major < minimum.major) return false;
  return version.minor >= minimum.minor;
};

const comparatorMajor = (comparator: string): number | null => {
  if (PEER_WILDCARD_COMPARATOR.test(comparator)) return null;
  const firstIntegerMatch = comparator.match(/\d+/);
  if (!firstIntegerMatch) return null;
  const major = Number.parseInt(firstIntegerMatch[0], 10);
  return major >= 1 ? major : null;
};

export const reactPeerRangeMinMajor = (range: string | null | undefined): number | null => {
  if (typeof range !== "string") return null;
  let lowestMajor: number | null = null;
  for (const comparator of range.trim().split(PEER_COMPARATOR_SEPARATOR).filter(Boolean)) {
    const major = comparatorMajor(comparator);
    if (major !== null && (lowestMajor === null || major < lowestMajor)) {
      lowestMajor = major;
    }
  }
  return lowestMajor;
};

const effectiveReactMajor = (project: ReactDoctorOxlintProjectInfo): number => {
  const installedMajor = project.reactMajorVersion ?? null;
  const peerMajor = reactPeerRangeMinMajor(project.reactPeerDependencyRange);
  if (installedMajor !== null && peerMajor !== null) return Math.min(installedMajor, peerMajor);
  return installedMajor ?? peerMajor ?? 99;
};

export const buildReactDoctorOxlintCapabilities = (
  project: ReactDoctorOxlintProjectInfo,
): ReadonlySet<string> => {
  const capabilities = new Set<string>();
  const framework = project.framework ?? "unknown";
  capabilities.add(framework);
  if (framework === "expo" || framework === "react-native") capabilities.add("react-native");

  const reactMajor = effectiveReactMajor(project);
  for (let major = 17; major <= reactMajor; major++) {
    capabilities.add(`react:${major}`);
  }

  if (project.tailwindVersion !== null) {
    capabilities.add("tailwind");
    if (isTailwindAtLeast(parseMajorMinor(project.tailwindVersion), { major: 3, minor: 4 })) {
      capabilities.add("tailwind:3.4");
    }
  }

  if (project.hasReactCompiler) capabilities.add("react-compiler");
  if (project.hasTanStackAI) capabilities.add("tanstack-ai");
  if (project.hasTanStackQuery) capabilities.add("tanstack-query");
  if (project.hasTypeScript) capabilities.add("typescript");
  return capabilities;
};

export const shouldEnableReactDoctorOxlintRule = (
  requires: ReadonlyArray<string> | undefined,
  tags: ReadonlySet<string>,
  capabilities: ReadonlySet<string>,
  ignoredTags: ReadonlySet<string>,
): boolean => {
  if (requires) {
    for (const capability of requires) {
      if (!capabilities.has(capability)) return false;
    }
  }
  for (const tag of tags) {
    if (ignoredTags.has(tag)) return false;
  }
  return true;
};

const addEnabledRules = (
  target: OxlintRuleSeverityMap,
  rules: OxlintRuleSeverityMap,
  capabilities: ReadonlySet<string>,
  ignoredTags: ReadonlySet<string>,
  defaultRequires?: ReadonlyArray<string>,
): void => {
  for (const [ruleKey, severity] of Object.entries(rules)) {
    const metadata = RULE_METADATA.get(ruleKey);
    const requires = metadata?.requires ?? defaultRequires;
    const tags = metadata?.tags ?? EMPTY_TAGS;
    if (shouldEnableReactDoctorOxlintRule(requires, tags, capabilities, ignoredTags)) {
      target[ruleKey] = severity;
    }
  }
};

export const createReactDoctorOxlintConfig = ({
  pluginPath,
  project,
  framework = "unknown",
  customRulesOnly = false,
  hasReactCompiler = false,
  hasTanStackAI = false,
  hasTanStackQuery = false,
  includeEcosystemRules = true,
  extendsPaths = [],
  ignoredTags = DEFAULT_IGNORED_TAGS,
}: ReactDoctorOxlintConfigOptions): ReactDoctorOxlintGeneratedConfig => {
  const projectInfo: ReactDoctorOxlintProjectInfo = project ?? {
    framework,
    hasReactCompiler,
    hasTanStackAI,
    hasTanStackQuery,
  };
  const capabilities = buildReactDoctorOxlintCapabilities(projectInfo);
  const reactCompilerConfig = buildOptionalReactCompilerConfig(
    customRulesOnly,
    Boolean(projectInfo.hasReactCompiler),
  );
  const jsPlugins: Array<string | ReactDoctorOxlintJsPluginEntry> = [];
  if (reactCompilerConfig.jsPlugin) jsPlugins.push(reactCompilerConfig.jsPlugin);
  jsPlugins.push(pluginPath);
  const enabledReactDoctorRules: OxlintRuleSeverityMap = {};
  addEnabledRules(
    enabledReactDoctorRules,
    GLOBAL_REACT_DOCTOR_OXLINT_RULES,
    capabilities,
    ignoredTags,
  );
  for (const ruleGroup of REACT_DOCTOR_FRAMEWORK_RULE_GROUPS) {
    addEnabledRules(
      enabledReactDoctorRules,
      ruleGroup.rules,
      capabilities,
      ignoredTags,
      ruleGroup.requires,
    );
  }
  if (includeEcosystemRules) {
    addEnabledRules(enabledReactDoctorRules, ECOSYSTEM_OXLINT_RULES, capabilities, ignoredTags);
  }

  return {
    ...(extendsPaths.length > 0 ? { extends: extendsPaths } : {}),
    categories: { ...DISABLED_OXLINT_CATEGORIES },
    plugins: customRulesOnly ? [] : ["react", "jsx-a11y"],
    jsPlugins,
    rules: {
      ...(customRulesOnly ? {} : BUILTIN_OXLINT_RULES),
      ...reactCompilerConfig.rules,
      ...enabledReactDoctorRules,
    },
  };
};
