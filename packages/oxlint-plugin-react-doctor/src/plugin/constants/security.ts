// Real-world API keys, tokens, and credentials are 24+ chars. 8 chars produced
// many false positives on UI strings ("loading...", short captions, etc.).
export const SECRET_MIN_LENGTH_CHARS = 24;
export const AUTH_CHECK_LOOKAHEAD_STATEMENTS = 10;

export const AUTH_FUNCTION_NAMES = new Set([
  "auth",
  "getSession",
  "getServerSession",
  "getUser",
  "requireAuth",
  "checkAuth",
  "verifyAuth",
  "authenticate",
  "currentUser",
  "getAuth",
  "validateSession",
]);

export const SECRET_PATTERNS = [
  /^sk_live_/,
  /^sk_test_/,
  /^AKIA[0-9A-Z]{16}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^gho_[a-zA-Z0-9]{36}$/,
  /^github_pat_/,
  /^glpat-/,
  /^xox[bporas]-/,
  /^sk-[a-zA-Z0-9]{32,}$/,
];

export const SECRET_VARIABLE_PATTERN = /(?:api_?key|secret|token|password|credential|auth)/i;

export const SECRET_TOOLING_FILE_PATTERN = /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export const SECRET_TOOLING_RC_FILE_PATTERN = /(?:^|\/)(?:\.[a-z-]+rc|[a-z-]+\.rc)\.[cm]?[jt]s$/;

export const SECRET_TEST_FILE_PATTERN =
  /(?:^|\/)[^/]+\.(?:test|spec|stories|story|fixture|fixtures)\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_FILE_SUFFIX_PATTERN = /(?:^|\/)[^/]+\.server\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_ENTRY_FILE_PATTERN = /(?:^|\/)(?:middleware|route)\.[cm]?[jt]sx?$/;

export const SECRET_NEXT_PAGES_API_FILE_PATTERN = /(?:^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/;

export const SECRET_CLIENT_FILE_SUFFIX_PATTERN =
  /(?:^|\/)[^/]+\.(?:client|browser|web)\.[cm]?[jt]sx?$/;

export const SECRET_CLIENT_ENTRY_FILE_PATTERN =
  /(?:^|\/)(?:src\/)?(?:main|index|[Aa]pp|client)\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_DIRECTORY_NAMES = new Set([
  "backend",
  "functions",
  "lambdas",
  "lambda",
  "middleware",
  "server",
  "servers",
]);

export const SECRET_SERVER_SOURCE_ROOT_OWNER_NAMES = new Set([
  "api",
  "backend",
  "edge",
  "function",
  "functions",
  "lambda",
  "lambdas",
  "server",
  "servers",
  "worker",
  "workers",
]);

export const SECRET_TEST_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "fixtures",
  "mocks",
  "test",
  "tests",
]);

export const SECRET_TOOLING_DIRECTORY_NAMES = new Set([
  "bin",
  "config",
  "configs",
  "script",
  "scripts",
  "tooling",
  "tools",
]);

export const SECRET_CLIENT_SOURCE_DIRECTORY_NAMES = new Set([
  "components",
  "features",
  "hooks",
  "pages",
  "ui",
  "views",
  "widgets",
]);

export const SECRET_FALSE_POSITIVE_SUFFIXES = new Set([
  "modal",
  "label",
  "text",
  "title",
  "name",
  "id",
  "url",
  "path",
  "route",
  "page",
  "param",
  "field",
  "column",
  "header",
  "placeholder",
  "prefix",
  "description",
  "type",
  "icon",
  "class",
  "style",
  "variant",
  "event",
  "action",
  "status",
  "state",
  "mode",
  "flag",
  "option",
  "config",
  "message",
  "error",
  "display",
  "view",
  "component",
  "element",
  "container",
  "wrapper",
  "button",
  "link",
  "input",
  "select",
  "dialog",
  "menu",
  "form",
  "step",
  "index",
  "count",
  "length",
  "role",
  "scope",
  "context",
  "provider",
  "ref",
  "handler",
  "query",
  "schema",
  "constant",
]);
