import path from "node:path";
import { render } from "ink";
import { App } from "./app.js";

export interface RunTuiOptions {
  directory: string;
  watch?: boolean;
  review?: boolean;
}

const isInteractiveTty = (): boolean =>
  Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);

export const runTui = async (options: RunTuiOptions): Promise<void> => {
  if (!isInteractiveTty()) {
    process.stderr.write(
      "react-doctor tui requires an interactive TTY. Run from a terminal, or use the standard `react-doctor` command for non-interactive output.\n",
    );
    process.exitCode = 1;
    return;
  }
  const initialMode = options.review ? "review" : "dashboard";
  const renderInstance = render(
    <App
      rootDirectory={path.resolve(options.directory)}
      initialMode={initialMode}
      startWatching={Boolean(options.watch)}
    />,
    { exitOnCtrlC: false },
  );
  await renderInstance.waitUntilExit();
};
