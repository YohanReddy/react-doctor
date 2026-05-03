import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { DEFAULT_VIEWPORT_HEIGHT_PX, DEFAULT_VIEWPORT_WIDTH_PX } from "../../constants.js";
import { ensurePage, ensureProtocol, ensureSession } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import { highlighter } from "../../utils/highlighter.js";
import { logger } from "../../utils/logger.js";

interface ScreenshotCommandOptions {
  output?: string;
  fullPage?: boolean;
  selector?: string;
  width: number;
  height: number;
  type: "png" | "jpeg";
  quality?: number;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
}

const parsePositiveInt = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
};

const parseImageType = (value: string): "png" | "jpeg" => {
  if (value === "png" || value === "jpeg") return value;
  if (value === "jpg") return "jpeg";
  throw new InvalidArgumentError("must be 'png' or 'jpeg'");
};

const resolveOutputPath = (rawPath: string | undefined, type: "png" | "jpeg"): string => {
  const fallback = `screenshot-${Date.now()}.${type === "jpeg" ? "jpg" : "png"}`;
  const target = rawPath ?? fallback;
  return isAbsolute(target) ? target : resolve(process.cwd(), target);
};

export const screenshot = new Command()
  .name("screenshot")
  .description("Capture a screenshot from the active session (auto-starts one if none exists).")
  .argument(
    "[url]",
    "navigate to this URL before screenshotting (optional if a page is already open)",
  )
  .option("-o, --output <path>", "output image path (defaults to ./screenshot-<ts>.png in cwd)")
  .option("-f, --full-page", "capture the full scrollable page (not just the viewport)")
  .option("-s, --selector <sel>", "screenshot a specific CSS selector instead of the page")
  .option("--width <px>", "viewport width in pixels", parsePositiveInt, DEFAULT_VIEWPORT_WIDTH_PX)
  .option(
    "--height <px>",
    "viewport height in pixels",
    parsePositiveInt,
    DEFAULT_VIEWPORT_HEIGHT_PX,
  )
  .option("--type <fmt>", "image format: png | jpeg", parseImageType, "png")
  .option("--quality <n>", "JPEG quality 0-100 (ignored for PNG)", parsePositiveInt)
  .option(
    "--wait-until <state>",
    "navigation wait condition: load | domcontentloaded | networkidle | commit",
    "load",
  )
  .action(async (rawUrl: string | undefined, options: ScreenshotCommandOptions) => {
    try {
      const session = await ensureSession();

      try {
        const page = await ensurePage(session.browser, {
          url: rawUrl ? ensureProtocol(rawUrl) : undefined,
          waitUntil: options.waitUntil,
        });

        await page.setViewportSize({ width: options.width, height: options.height });

        const outputPath = resolveOutputPath(options.output, options.type);
        await mkdir(dirname(outputPath), { recursive: true });

        const screenshotOptions: Parameters<typeof page.screenshot>[0] = {
          path: outputPath,
          type: options.type,
          fullPage: options.fullPage ?? false,
        };
        if (options.type === "jpeg" && options.quality !== undefined) {
          screenshotOptions.quality = options.quality;
        }

        if (options.selector) {
          await page.locator(options.selector).screenshot(screenshotOptions);
        } else {
          await page.screenshot(screenshotOptions);
        }

        logger.success(`Screenshot written to ${highlighter.info(outputPath)}.`);
      } finally {
        await session.disconnect();
      }
    } catch (error) {
      handleError(error);
    }
  });
