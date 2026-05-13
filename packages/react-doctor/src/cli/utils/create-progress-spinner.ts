import { performance } from "node:perf_hooks";
import ora, { type Ora } from "ora";
import { SPINNER_FRAME_INTERVAL_MS } from "../../constants.js";
import { highlighter } from "../highlighter.js";
import { formatElapsedTime } from "./format-elapsed-time.js";

export interface ProgressSpinner {
  stop: () => void;
}

const NOOP_SPINNER: ProgressSpinner = { stop: () => {} };

const renderSpinnerText = (label: string, elapsedMilliseconds: number): string =>
  `${label} ${highlighter.dim(formatElapsedTime(elapsedMilliseconds))}`;

export const createProgressSpinner = (label: string): ProgressSpinner => {
  if (!process.stdout.isTTY) return NOOP_SPINNER;

  const startTimeMilliseconds = performance.now();
  const spinner: Ora = ora({
    text: renderSpinnerText(label, 0),
    color: "cyan",
    discardStdin: false,
  }).start();

  const tickHandle = setInterval(() => {
    spinner.text = renderSpinnerText(label, performance.now() - startTimeMilliseconds);
  }, SPINNER_FRAME_INTERVAL_MS);

  let isStopped = false;
  const cleanupOnExit = () => {
    if (isStopped) return;
    clearInterval(tickHandle);
    spinner.stop();
  };
  process.once("exit", cleanupOnExit);

  return {
    stop: () => {
      if (isStopped) return;
      isStopped = true;
      clearInterval(tickHandle);
      spinner.stop();
      process.off("exit", cleanupOnExit);
    },
  };
};
