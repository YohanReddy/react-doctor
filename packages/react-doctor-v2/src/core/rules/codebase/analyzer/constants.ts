export const SOURCE_FILE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
] as const;

export const ASSET_FILE_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".less",
  ".module.css",
  ".module.scss",
  ".png",
  ".sass",
  ".scss",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

export const DECLARATION_FILE_EXTENSION = ".d.ts";

export const TYPESCRIPT_DECLARATION_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts"];

export const IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export const PACKAGE_JSON_FILENAME = "package.json";
export const REACT_CLIENT_DIRECTIVE = "use client";
export const REACT_SERVER_DIRECTIVE = "use server";
export const SERVER_ONLY_PACKAGE_NAME = "server-only";
export const DEFINITELY_TYPED_SCOPE = "@types";

export const DEFAULT_CONDITION_NAMES = ["types", "import", "module", "browser", "node", "default"];

export const RESOLVE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
];

export const BARREL_EXPORT_THRESHOLD_COUNT = 5;
export const BARREL_IMPORTER_THRESHOLD_COUNT = 3;
export const POSITION_BASE_OFFSET = 1;

export const COMMON_ENTRY_STEMS = new Set(["App", "index", "main"]);

export const FRAMEWORK_ROUTE_ENTRY_STEMS = new Set([
  "_app",
  "_document",
  "error",
  "global-error",
  "layout",
  "loading",
  "not-found",
  "page",
  "route",
  "template",
]);

export const TEST_ENTRY_MARKERS = [".test.", ".spec.", ".testcase.", ".stories.", ".story."];

export const SUPPORT_ENTRY_PATTERNS = [
  "**/*.eval.{js,jsx,ts,tsx}",
  "evalite.config.{js,mjs,cjs,ts,mts,cts}",
];

export const WHOLE_OBJECT_MEMBER_METHODS = new Set([
  "entries",
  "getOwnPropertyNames",
  "keys",
  "values",
]);

export const CHILD_PROCESS_ENTRY_METHODS = new Set(["execFile", "fork", "spawn"]);
export const CHILD_PROCESS_MODULE_SPECIFIERS = new Set(["child_process", "node:child_process"]);
export const NODE_MODULE_SPECIFIERS = new Set(["module", "node:module"]);
export const PATH_MODULE_SPECIFIERS = new Set(["node:path", "path"]);
export const PATH_ENTRY_HELPER_METHODS = new Set(["join", "resolve"]);
export const WORKER_THREADS_MODULE_SPECIFIERS = new Set(["node:worker_threads", "worker_threads"]);

export const PUBLIC_VISIBILITY_TAGS = new Set(["public", "alpha", "beta"]);
export const INTERNAL_VISIBILITY_TAG = "internal";
export const EXPECTED_UNUSED_VISIBILITY_TAG = "expected-unused";

export const CODEBASE_RULE_CATEGORY = "codebase";

export const DEAD_CODE_CHECK_ID = "react-doctor/codebase/dead-code";
export const REACT_ARCHITECTURE_CHECK_ID = "react-doctor/codebase/react-architecture";
export const DEPENDENCIES_CHECK_ID = "react-doctor/codebase/dependencies";

export const SOURCE_ENTRY_FIELDS = ["source", "main", "module", "browser", "types", "typings"];

export const MANIFEST_CONFIG_DEPENDENCY_FIELDS = [
  "babel",
  "commitlint",
  "eslintConfig",
  "jest",
  "lint-staged",
  "prettier",
  "release",
  "semantic-release",
  "simple-git-hooks",
  "vitest",
];

export const SCRIPT_COMMAND_SEPARATORS = new Set(["&&", "||", ";", "|"]);

export const SCRIPT_IGNORED_COMMANDS = new Set([
  "bun",
  "cd",
  "echo",
  "exit",
  "export",
  "mkdir",
  "node",
  "npm",
  "pnpm",
  "rm",
  "yarn",
]);

export const SCRIPT_WRAPPER_COMMANDS = new Set(["cross-env", "dotenv", "env-cmd"]);

export const SCRIPT_RUNNER_COMMANDS = new Set(["bunx", "npx"]);

export const SCRIPT_PACKAGE_MANAGER_RUNNER_SUBCOMMANDS: Record<string, Set<string>> = {
  bun: new Set(["x"]),
  npm: new Set(["exec", "x"]),
  pnpm: new Set(["dlx", "exec"]),
  yarn: new Set(["dlx", "exec"]),
};

export const SCRIPT_BINARY_PACKAGE_NAME_ALIASES: Record<string, string[]> = {
  eslint: ["eslint"],
  jest: ["jest"],
  "lint-staged": ["lint-staged"],
  next: ["next"],
  playwright: ["@playwright/test", "playwright"],
  prettier: ["prettier"],
  "run-p": ["npm-run-all"],
  "run-s": ["npm-run-all"],
  storybook: ["storybook", "@storybook/react", "@storybook/nextjs"],
  tsc: ["typescript"],
  tsup: ["tsup"],
  tsx: ["tsx"],
  turbo: ["turbo"],
  vite: ["vite"],
  vitest: ["vitest"],
};

export const IGNORED_DEFINITELY_TYPED_PACKAGE_NAMES = new Set(["node", "bun", "jest"]);

export const DEFAULT_INCLUDE_PATHS = ["."];
