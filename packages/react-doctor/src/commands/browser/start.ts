import { Command } from "commander";
import { ensurePage, ensureProtocol, ensureSession } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import { highlighter } from "../../utils/highlighter.js";
import { logger } from "../../utils/logger.js";

interface StartOptions {
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export const start = new Command()
  .name("start")
  .description(
    "Start a long-running headless browser session. Subsequent snapshot/screenshot commands reuse it.",
  )
  .argument("[url]", "optional URL to navigate to immediately after starting")
  .option(
    "--wait-until <state>",
    "navigation wait condition: load | domcontentloaded | networkidle | commit",
    "load",
  )
  .action(async (rawUrl: string | undefined, options: StartOptions) => {
    try {
      const session = await ensureSession();

      try {
        if (rawUrl) {
          const url = ensureProtocol(rawUrl);
          await ensurePage(session.browser, { url, waitUntil: options.waitUntil });
        }
      } finally {
        await session.disconnect();
      }

      const action = session.freshlyLaunched ? "Started" : "Reusing";
      logger.success(
        `${action} browser session (pid ${highlighter.info(String(session.state.pid))}).`,
      );
      logger.log(
        `  Run ${highlighter.info("react-doctor browser snapshot")} or ${highlighter.info(
          "react-doctor browser screenshot",
        )} to interact.`,
      );
      logger.log(`  Run ${highlighter.info("react-doctor browser stop")} when done.`);
    } catch (error) {
      handleError(error);
    }
  });
