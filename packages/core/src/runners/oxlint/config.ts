import fs from "node:fs";
import reactDoctorPlugin, {
  REACT_COMPILER_RULES,
  REACT_DOCTOR_RULES,
} from "oxlint-plugin-react-doctor";
import type { OxlintRuleSeverity } from "oxlint-plugin-react-doctor";
import type { ProjectInfo, RuleSeverityControls } from "@react-doctor/types";
import { resolveRuleSeverityOverride } from "../../resolve-rule-severity-override.js";
import { buildCapabilities, shouldEnableRule } from "./capabilities.js";
import { filterRulesToAvailable, resolveReactHooksJsPlugin } from "./plugin-resolution.js";
import type { JsPluginEntry } from "./plugin-resolution.js";

export interface OxlintConfigOptions {
  pluginPath: string;
  project: ProjectInfo;
  customRulesOnly?: boolean;
  extendsPaths?: string[];
  ignoredTags?: ReadonlySet<string>;
  serverAuthFunctionNames?: ReadonlyArray<string>;
  severityControls?: RuleSeverityControls;
}

const resolveSettingsRootDirectory = (rootDirectory: string): string => {
  if (!fs.existsSync(rootDirectory)) return rootDirectory;
  return fs.realpathSync(rootDirectory);
};

const applyRuleSeverityControls = (
  rules: Record<string, OxlintRuleSeverity>,
  severityControls: RuleSeverityControls | undefined,
): Record<string, OxlintRuleSeverity> => {
  const enabledRules: Record<string, OxlintRuleSeverity> = {};
  for (const [ruleKey, defaultSeverity] of Object.entries(rules)) {
    const severity = resolveRuleSeverityOverride({ ruleKey }, severityControls) ?? defaultSeverity;
    if (severity === "off") continue;
    enabledRules[ruleKey] = severity;
  }
  return enabledRules;
};

export const createOxlintConfig = ({
  pluginPath,
  project,
  customRulesOnly = false,
  extendsPaths = [],
  ignoredTags = new Set<string>(),
  serverAuthFunctionNames,
  severityControls,
}: OxlintConfigOptions) => {
  const reactHooksJsPlugin = resolveReactHooksJsPlugin(project.hasReactCompiler, customRulesOnly);
  const reactCompilerRules = reactHooksJsPlugin
    ? applyRuleSeverityControls(
        filterRulesToAvailable(
          REACT_COMPILER_RULES,
          "react-hooks-js",
          reactHooksJsPlugin.availableRuleNames,
        ),
        severityControls,
      )
    : {};

  const jsPlugins: JsPluginEntry[] = [];
  if (reactHooksJsPlugin) jsPlugins.push(reactHooksJsPlugin.entry);

  const capabilities = buildCapabilities(project);

  const enabledReactDoctorRules: Record<string, OxlintRuleSeverity> = {};
  for (const registryEntry of REACT_DOCTOR_RULES) {
    const rule = reactDoctorPlugin.rules[registryEntry.id];
    if (!rule) continue;
    // `customRulesOnly` mirrors the historical behavior of the
    // pre-port `BUILTIN_REACT_RULES` / `BUILTIN_A11Y_RULES` gate —
    // skip everything ported 1:1 from upstream OXC plugins.
    if (customRulesOnly && registryEntry.originallyExternal) continue;
    if (rule.framework !== "global" && !rule.requires) continue;
    if (!shouldEnableRule(rule.requires, rule.tags, capabilities, ignoredTags)) continue;
    const severity =
      resolveRuleSeverityOverride(
        { ruleKey: registryEntry.key, category: rule.category },
        severityControls,
      ) ?? rule.severity;
    if (severity === "off") continue;
    enabledReactDoctorRules[registryEntry.key] = severity;
  }

  return {
    ...(extendsPaths.length > 0 ? { extends: extendsPaths } : {}),
    categories: {
      correctness: "off",
      suspicious: "off",
      pedantic: "off",
      perf: "off",
      restriction: "off",
      style: "off",
      nursery: "off",
    },
    // We don't load any OXC built-in plugins anymore — every `react/*`
    // and `jsx-a11y/*` rule has been ported into `react-doctor/*`. The
    // empty `plugins:` array is intentional; rules come exclusively
    // from our codegen-built registry plus configured npm-shipped
    // plugins (react-hooks-js for the React Compiler frontend etc.).
    plugins: [],
    jsPlugins: [...jsPlugins, pluginPath],
    settings: {
      "react-doctor": {
        framework: project.framework,
        rootDirectory: resolveSettingsRootDirectory(project.rootDirectory),
        ...(serverAuthFunctionNames && serverAuthFunctionNames.length > 0
          ? { serverAuthFunctionNames: [...serverAuthFunctionNames] }
          : {}),
      },
    },
    rules: {
      ...reactCompilerRules,
      ...enabledReactDoctorRules,
    },
  };
};
