import { Command } from "commander";
import { loadActiveSession, sessionFilePath } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import { highlighter } from "../../utils/highlighter.js";
import { logger } from "../../utils/logger.js";

export const status = new Command()
  .name("status")
  .description("Show whether a browser session is active and where its state file lives.")
  .action(async () => {
    try {
      const state = await loadActiveSession();
      if (!state) {
        logger.log("No active browser session.");
        logger.log(`  State file: ${highlighter.dim(sessionFilePath())}`);
        return;
      }
      logger.success("Browser session is active.");
      logger.log(`  pid:         ${highlighter.info(String(state.pid))}`);
      logger.log(`  ws:          ${highlighter.info(state.wsUrl)}`);
      logger.log(`  userDataDir: ${highlighter.info(state.userDataDir)}`);
      logger.log(`  startedAt:   ${highlighter.info(new Date(state.startedAt).toISOString())}`);
      logger.log(`  state file:  ${highlighter.dim(sessionFilePath())}`);
    } catch (error) {
      handleError(error);
    }
  });
