import path from "node:path";
import { Command } from "commander";
import { render } from "ink";
import { App } from "./app.js";

const VERSION = process.env.VERSION ?? "0.0.0";

interface TuiCliFlags {
  watch: boolean;
  review: boolean;
}

export interface RunTuiOptions {
  directory: string;
  watch?: boolean;
  review?: boolean;
}

export const runTui = async (options: RunTuiOptions): Promise<void> => {
  const isInteractiveTty = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  if (!isInteractiveTty) {
    process.stderr.write(
      "react-doctor-tui requires an interactive TTY. Run from a terminal, or use `react-doctor` for non-interactive output.\n",
    );
    process.exit(1);
  }
  const initialMode = options.review ? "review" : "dashboard";
  const renderInstance = render(
    <App
      rootDirectory={path.resolve(options.directory)}
      initialMode={initialMode}
      startWatching={Boolean(options.watch)}
    />,
    { exitOnCtrlC: false, patchConsole: false, alternateScreen: true },
  );
  await renderInstance.waitUntilExit();
};

const program = new Command()
  .name("react-doctor-tui")
  .description("Interactive React code-health TUI for react-doctor")
  .version(VERSION, "-v, --version", "display the version number")
  .argument("[directory]", "project directory to scan", ".")
  .option("--watch", "rescan automatically when source files change", false)
  .option("--review", "open straight into the diagnostic review screen", false)
  .action(async (directory: string, flags: TuiCliFlags) => {
    await runTui({ directory, watch: flags.watch, review: flags.review });
  });

const wasInvokedDirectly = ((): boolean => {
  const entryUrl = process.argv[1];
  if (!entryUrl) return false;
  const normalizedEntry = entryUrl.replace(/\\/g, "/");
  return (
    normalizedEntry.endsWith("react-doctor-tui.js") ||
    normalizedEntry.endsWith("/dist/cli.js") ||
    normalizedEntry.includes("react-doctor-tui/bin/")
  );
})();

if (wasInvokedDirectly) {
  program.parseAsync().catch((commanderError: unknown) => {
    process.stderr.write(
      `react-doctor-tui failed: ${(commanderError as Error)?.message ?? commanderError}\n`,
    );
    process.exit(1);
  });
}
