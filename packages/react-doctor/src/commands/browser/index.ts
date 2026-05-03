import { Command } from "commander";
import { playwright } from "./playwright.js";
import { screenshot } from "./screenshot.js";
import { snapshot } from "./snapshot.js";
import { start } from "./start.js";
import { status } from "./status.js";
import { stop } from "./stop.js";

export const browser = new Command()
  .name("browser")
  .description(
    "Control a long-running headless browser session for snapshots, screenshots, and Playwright evaluations. The session persists across invocations until you run `react-doctor browser stop`.",
  );

browser.addCommand(start);
browser.addCommand(stop);
browser.addCommand(status);
browser.addCommand(snapshot);
browser.addCommand(screenshot);
browser.addCommand(playwright);
