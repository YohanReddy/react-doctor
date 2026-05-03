import { writeFile } from "node:fs/promises";
import { Browser, silentLogger } from "react-doctor-browser";
import { Command, InvalidArgumentError } from "commander";
import { SNAPSHOT_TIMEOUT_DEFAULT_MS } from "../../constants.js";
import { ensurePage, ensureProtocol, ensureSession } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import { highlighter } from "../../utils/highlighter.js";
import { logger } from "../../utils/logger.js";

interface SnapshotCommandOptions {
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
  output?: string;
  json?: boolean;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeout: number;
}

const parseNonNegativeInt = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
};

const writeOutput = async (output: string | undefined, payload: string): Promise<void> => {
  if (output) {
    await writeFile(output, payload, "utf8");
    logger.success(`Snapshot written to ${highlighter.info(output)}.`);
    return;
  }
  process.stdout.write(payload);
  if (!payload.endsWith("\n")) process.stdout.write("\n");
};

export const snapshot = new Command()
  .name("snapshot")
  .description("Capture an ARIA snapshot from the active session (auto-starts one if none exists).")
  .argument(
    "[url]",
    "navigate to this URL before snapshotting (optional if a page is already open)",
  )
  .option("-i, --interactive", "only show interactive elements (buttons, links, inputs)")
  .option("-c, --compact", "remove empty structural elements")
  .option("-d, --depth <n>", "limit tree depth", parseNonNegativeInt)
  .option("-s, --selector <sel>", "scope to a CSS selector", "body")
  .option("-o, --output <path>", "write the snapshot to a file instead of stdout")
  .option("--json", "emit JSON ({ tree, refs, stats }) instead of plain text")
  .option(
    "--wait-until <state>",
    "navigation wait condition: load | domcontentloaded | networkidle | commit",
    "load",
  )
  .option(
    "--timeout <ms>",
    "snapshot timeout in milliseconds",
    parseNonNegativeInt,
    SNAPSHOT_TIMEOUT_DEFAULT_MS,
  )
  .action(async (rawUrl: string | undefined, options: SnapshotCommandOptions) => {
    try {
      const session = await ensureSession();

      try {
        const page = await ensurePage(session.browser, {
          url: rawUrl ? ensureProtocol(rawUrl) : undefined,
          waitUntil: options.waitUntil,
        });

        const browser = new Browser(silentLogger);
        const result = await browser.snapshot(page, {
          interactive: options.interactive,
          compact: options.compact,
          maxDepth: options.depth,
          selector: options.selector,
          timeout: options.timeout,
        });

        if (options.json) {
          await writeOutput(
            options.output,
            JSON.stringify({ tree: result.tree, refs: result.refs, stats: result.stats }, null, 2),
          );
        } else {
          await writeOutput(options.output, result.tree);
        }
      } finally {
        await session.disconnect();
      }
    } catch (error) {
      handleError(error);
    }
  });
