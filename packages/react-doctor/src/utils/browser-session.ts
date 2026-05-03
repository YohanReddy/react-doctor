import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launchSystemChrome, silentLogger } from "react-doctor-browser";
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright";
import {
  CDP_CONNECT_TIMEOUT_MS,
  SESSION_DIR_NAME,
  SESSION_FILE_NAME,
  SIGTERM_GRACE_PERIOD_MS,
  SIGTERM_POLL_INTERVAL_MS,
} from "../constants.js";

export interface BrowserSessionState {
  pid: number;
  wsUrl: string;
  userDataDir: string;
  // HACK: only set when react-doctor itself created a throwaway profile
  // (i.e. the launchSession path). When undefined, the userDataDir
  // belongs to a Chrome we attached to, NEVER ours to wipe. Splitting
  // the two fields makes "is this profile mine to delete?" explicit.
  tempUserDataDir: string | undefined;
  startedAt: number;
}

const SESSION_DIR = join(homedir(), SESSION_DIR_NAME);
const SESSION_FILE = join(SESSION_DIR, SESSION_FILE_NAME);

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EPERM") return true;
    return false;
  }
};

const isBrowserSessionState = (value: unknown): value is BrowserSessionState => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.pid !== "number") return false;
  if (typeof candidate.wsUrl !== "string") return false;
  if (typeof candidate.userDataDir !== "string") return false;
  if (candidate.tempUserDataDir !== undefined && typeof candidate.tempUserDataDir !== "string") {
    return false;
  }
  if (typeof candidate.startedAt !== "number") return false;
  return true;
};

const readSessionFile = async (): Promise<BrowserSessionState | undefined> => {
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isBrowserSessionState(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};

const writeSessionFile = async (state: BrowserSessionState): Promise<void> => {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2), "utf8");
};

const deleteSessionFile = async (): Promise<void> => {
  await rm(SESSION_FILE, { force: true });
};

export const loadActiveSession = async (): Promise<BrowserSessionState | undefined> => {
  const state = await readSessionFile();
  if (!state) return undefined;
  if (!isProcessAlive(state.pid)) {
    await deleteSessionFile().catch(() => {});
    return undefined;
  }
  return state;
};

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((cause) => {
        clearTimeout(timer);
        reject(cause);
      });
  });

export const launchSession = async (): Promise<{
  state: BrowserSessionState;
  freshlyLaunched: true;
}> => {
  const profilePath = join(tmpdir(), `react-doctor-browser-${process.pid}-${Date.now()}`);
  const chrome = await launchSystemChrome({
    headless: true,
    profilePath,
    detached: true,
    logger: silentLogger,
  });

  const state: BrowserSessionState = {
    pid: chrome.process.pid ?? -1,
    wsUrl: chrome.wsUrl,
    userDataDir: chrome.userDataDir,
    // HACK: launchSession is the ONLY path that creates a throwaway
    // profile, so it's the only path that should mark it for cleanup.
    // Future "attach to existing Chrome" flows must leave this
    // undefined so stopSession doesn't wipe a real user's profile.
    tempUserDataDir: profilePath,
    startedAt: Date.now(),
  };

  await writeSessionFile(state);
  return { state, freshlyLaunched: true };
};

export interface ConnectedSession {
  browser: PlaywrightBrowser;
  state: BrowserSessionState;
  freshlyLaunched: boolean;
  disconnect: () => Promise<void>;
}

export const ensureSession = async (): Promise<ConnectedSession> => {
  const existing = await loadActiveSession();
  const { state, freshlyLaunched } = existing
    ? { state: existing, freshlyLaunched: false }
    : await launchSession();

  let browser: PlaywrightBrowser;
  try {
    browser = await withTimeout(
      chromium.connectOverCDP(state.wsUrl),
      CDP_CONNECT_TIMEOUT_MS,
      `Failed to connect to browser session at ${state.wsUrl} within ${CDP_CONNECT_TIMEOUT_MS}ms`,
    );
  } catch (cause) {
    await deleteSessionFile().catch(() => {});
    throw cause;
  }

  // HACK: a freshly launched Chrome lands its first tab on chrome://newtab/
  // (or chrome://welcome on first run), not about:blank. Without normalizing,
  // a bare `snapshot` against a fresh session would happily snapshot the
  // Chrome new-tab page (Web Store / Customize buttons) instead of erroring
  // with "no page open". Force about:blank so ensurePage's check is reliable.
  if (freshlyLaunched) {
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext({ ignoreHTTPSErrors: true }));
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    if (page.url() !== "about:blank") {
      await page.goto("about:blank").catch(() => {});
    }
  }

  return {
    browser,
    state,
    freshlyLaunched,
    disconnect: async () => {
      await browser.close().catch(() => {});
    },
  };
};

export interface EnsurePageOptions {
  url?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

export const ensurePage = async (
  browser: PlaywrightBrowser,
  options: EnsurePageOptions = {},
): Promise<Page> => {
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext({ ignoreHTTPSErrors: true }));
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());

  if (options.url && page.url() !== options.url) {
    await page.goto(options.url, { waitUntil: options.waitUntil ?? "load" });
  } else if (!options.url && page.url() === "about:blank") {
    throw new Error(
      "No page is open in the browser session. Pass a URL or run `react-doctor browser start <url>` first.",
    );
  }

  return page;
};

export interface StopSessionResult {
  pid: number;
  wasRunning: boolean;
}

// HACK: SIGTERM lets Chrome flush its on-disk profile and close child
// renderers cleanly, but a hung Chrome will ignore it forever. Poll
// briefly, then escalate to SIGKILL so we never leak a zombie process
// holding the CDP port (subsequent `start` would land on a stale port
// and fail the wsUrl handshake).
const terminateProcessGracefully = async (pid: number): Promise<void> => {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  const deadline = Date.now() + SIGTERM_GRACE_PERIOD_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(SIGTERM_POLL_INTERVAL_MS);
  }

  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already gone between the alive check and the SIGKILL.
  }
};

export const stopSession = async (): Promise<StopSessionResult> => {
  const state = await readSessionFile();
  if (!state) return { pid: -1, wasRunning: false };

  const wasRunning = isProcessAlive(state.pid);
  if (wasRunning) {
    await terminateProcessGracefully(state.pid);
  }

  if (state.tempUserDataDir) {
    await rm(state.tempUserDataDir, { recursive: true, force: true }).catch(() => {});
  }
  await deleteSessionFile().catch(() => {});

  return { pid: state.pid, wasRunning };
};

export const ensureProtocol = (rawUrl: string): string => {
  if (/^[a-z]+:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(rawUrl)) {
    return `http://${rawUrl}`;
  }
  return `https://${rawUrl}`;
};

export const sessionFilePath = (): string => SESSION_FILE;

export const sessionDir = (): string => dirname(SESSION_FILE);
