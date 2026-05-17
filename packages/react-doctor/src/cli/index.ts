import { Command } from "commander";
import { CANONICAL_GITHUB_URL, highlighter } from "@react-doctor/core";
import { inspectAction } from "./commands/inspect.js";
import { installAction } from "./commands/install.js";
import { exitGracefully } from "./utils/exit-gracefully.js";
import { handleError } from "./utils/handle-error.js";
import { isJsonModeActive, writeJsonErrorReport } from "./utils/json-mode.js";
import { VERSION } from "./utils/version.js";

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);

const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--lint", "enable linting")
  .option("--no-lint", "skip linting")
  .option("--verbose", "show every rule and per-file details (default shows top 3 rules)")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("--json-compact", "with --json, emit compact JSON (no indentation)")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("--full", "force a full scan (overrides any `diff` value in config or `--diff`)")
  .option("--project <name>", "select workspace project (comma-separated for multiple)")
  .option(
    "--diff [base]",
    "scan only files changed vs base branch (pass `false` to disable; overridden by --full)",
  )
  .option("--offline", "skip the score API and the share URL (no score is shown)")
  .option("--staged", "scan only staged (git index) files for pre-commit hooks")
  .option(
    "--fail-on <level>",
    "exit with error code on diagnostics: error, warning, none (default: error)",
  )
  .option("--annotations", "output diagnostics as GitHub Actions annotations")
  .option(
    "--pr-comment",
    "tune CLI output for sticky PR comments (drops weak-signal rule families like `design` from the printed list and the fail-on gate; configure via config.surfaces)",
  )
  .option(
    "--baseline [path]",
    "enable baseline mode - diagnostics matching the baseline file are dropped from CI / PR comments. Defaults to react-doctor-baseline.json",
  )
  .option(
    "--update-baseline",
    "record current diagnostics into the baseline file (no filtering, no exit code from new violations)",
  )
  .option(
    "--touched-lines",
    "in diff/staged mode, only count diagnostics on lines actually touched by the diff",
  )
  .option("--concurrency <n>", "scan up to N workspace projects in parallel (default: 1)")
  .option(
    "--pr-comment-output <path>",
    "write a sticky-PR-comment-ready markdown document to this file as a side effect of the scan (compose with --pr-comment for the build-log plaintext)",
  )
  .option(
    "--explain <file:line>",
    "diagnose why a rule fired or why a suppression didn't apply at a specific location",
  )
  .option("--why <file:line>", "alias for --explain")
  .option(
    "--respect-inline-disables",
    "respect inline `// eslint-disable*` / `// oxlint-disable*` comments (default)",
  )
  .option(
    "--no-respect-inline-disables",
    "audit mode: neutralize inline lint suppressions before scanning",
  )
  .addHelpText(
    "after",
    `
${highlighter.dim("Configuration:")}
  Place a ${highlighter.info("react-doctor.config.json")} (or ${highlighter.info('"reactDoctor"')} key in your package.json) in the project root.
  CLI flags always override config values. See the README for the full schema.

${highlighter.dim("Learn more:")}
  ${highlighter.info(CANONICAL_GITHUB_URL)}
`,
  );

program.action(inspectAction);

program
  .command("install")
  .alias("setup")
  .description("Install the react-doctor skill into your coding agents")
  .option("-y, --yes", "skip prompts, install for all detected agents")
  .option("--dry-run", "show what would be installed without writing files")
  .option("-c, --cwd <cwd>", "working directory", process.cwd())
  .action(installAction);

// HACK: when stdout is piped into a process that closes early (e.g.
// `react-doctor . | head`), Node throws an uncaught EPIPE on the next
// write. Exit cleanly instead of dumping a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
});

program.parseAsync().catch((error: unknown) => {
  if (isJsonModeActive()) {
    writeJsonErrorReport(error);
    process.exit(1);
  }
  handleError(error);
});
