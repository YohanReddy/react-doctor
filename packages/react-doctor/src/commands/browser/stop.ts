import { Command } from "commander";
import { stopSession } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import { highlighter } from "../../utils/highlighter.js";
import { logger } from "../../utils/logger.js";

export const stop = new Command()
  .name("stop")
  .description("Stop the active headless browser session and clean up its profile.")
  .action(async () => {
    try {
      const result = await stopSession();
      if (!result.wasRunning && result.pid === -1) {
        logger.log("No active browser session.");
        return;
      }
      if (!result.wasRunning) {
        logger.log(
          `Cleared stale session record (pid ${highlighter.info(String(result.pid))} was no longer running).`,
        );
        return;
      }
      logger.success(`Stopped browser session (pid ${highlighter.info(String(result.pid))}).`);
    } catch (error) {
      handleError(error);
    }
  });
