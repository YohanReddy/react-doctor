import { Command } from "commander";
import { runInThisContext } from "node:vm";
import { ensurePage, ensureProtocol, ensureSession } from "../../utils/browser-session.js";
import { handleError } from "../../utils/handle-error.js";
import type { Browser as PlaywrightBrowser, BrowserContext, Page } from "playwright";

interface PlaywrightCommandOptions {
  eval?: string;
  waitUntil: "load" | "domcontentloaded" | "networkidle" | "commit";
  json?: boolean;
}

interface PlaywrightEvalFn {
  (page: Page, browser: PlaywrightBrowser, context: BrowserContext): Promise<unknown>;
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const compileEval = (sourceCode: string): PlaywrightEvalFn => {
  const compiled: PlaywrightEvalFn = runInThisContext(
    `(async (page, browser, context) => {\n${sourceCode}\n})`,
  );
  return compiled;
};

const formatResult = (value: unknown, alwaysJson: boolean): string => {
  if (value === undefined) return "";
  if (alwaysJson || (value !== null && typeof value === "object")) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

export const playwright = new Command()
  .name("playwright")
  .description(
    "Evaluate a Playwright snippet against the active session. The snippet runs as an async function with `page`, `browser`, and `context` in scope. Pass code via --eval or pipe it via stdin. JavaScript only — TypeScript and JSX are not transpiled.",
  )
  .argument("[url]", "navigate to this URL before evaluating (optional if a page is already open)")
  .option("-e, --eval <code>", "inline JS code to execute")
  .option(
    "--wait-until <state>",
    "navigation wait condition: load | domcontentloaded | networkidle | commit",
    "load",
  )
  .option(
    "--json",
    "JSON-stringify the return value even for primitives (objects are always stringified)",
  )
  .action(async (rawUrl: string | undefined, options: PlaywrightCommandOptions) => {
    try {
      let sourceCode: string;
      if (options.eval !== undefined) {
        sourceCode = options.eval;
      } else if (process.stdin.isTTY) {
        throw new Error("no script provided: pass --eval <code> or pipe code via stdin");
      } else {
        sourceCode = await readStdin();
      }

      if (!sourceCode.trim()) {
        throw new Error("script is empty");
      }

      const session = await ensureSession();
      try {
        const page = await ensurePage(session.browser, {
          url: rawUrl ? ensureProtocol(rawUrl) : undefined,
          waitUntil: options.waitUntil,
        });
        const context = page.context();

        const evalFn = compileEval(sourceCode);
        const result = await evalFn(page, session.browser, context);
        const formatted = formatResult(result, options.json ?? false);

        if (formatted) {
          process.stdout.write(formatted);
          if (!formatted.endsWith("\n")) process.stdout.write("\n");
        }
      } finally {
        await session.disconnect();
      }
    } catch (error) {
      handleError(error);
    }
  });
