import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SESSION_HOME_DIR = vi.hoisted(
  // HACK: hardcoded `/tmp` rather than `os.tmpdir()` because `vi.hoisted`
  // runs before imports — we can't reach the `os` / `path` module
  // bindings yet. The CLI tests only run on macOS/Linux, where `/tmp`
  // is always present and writable. The PID suffix isolates parallel
  // test runs from each other and from the developer's real
  // `~/.react-doctor/` (which is what we mock `homedir()` to redirect).
  () => `/tmp/react-doctor-cli-tests-${process.pid}`,
);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => SESSION_HOME_DIR,
  };
});

import {
  ensureProtocol,
  loadActiveSession,
  sessionDir,
  sessionFilePath,
  stopSession,
  type BrowserSessionState,
} from "../src/utils/browser-session.js";

const SESSION_FILE = path.join(SESSION_HOME_DIR, ".react-doctor", "browser.json");

const writeSession = (state: BrowserSessionState): void => {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state), "utf8");
};

const removeSession = (): void => {
  fs.rmSync(SESSION_FILE, { force: true });
};

beforeAll(() => {
  fs.mkdirSync(SESSION_HOME_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(SESSION_HOME_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  removeSession();
});

describe("ensureProtocol", () => {
  it("preserves an https URL", () => {
    expect(ensureProtocol("https://example.com")).toBe("https://example.com");
  });

  it("preserves an http URL", () => {
    expect(ensureProtocol("http://example.com/path")).toBe("http://example.com/path");
  });

  it("preserves a non-http scheme", () => {
    expect(ensureProtocol("file:///etc/hosts")).toBe("file:///etc/hosts");
  });

  it("prefixes localhost with http://", () => {
    expect(ensureProtocol("localhost:3000")).toBe("http://localhost:3000");
    expect(ensureProtocol("localhost")).toBe("http://localhost");
  });

  it("prefixes IPv4 hosts with http://", () => {
    expect(ensureProtocol("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(ensureProtocol("10.0.0.1")).toBe("http://10.0.0.1");
  });

  it("prefixes everything else with https://", () => {
    expect(ensureProtocol("example.com")).toBe("https://example.com");
    expect(ensureProtocol("react.doctor")).toBe("https://react.doctor");
  });
});

describe("sessionFilePath / sessionDir", () => {
  it("places the session file in <homedir>/.react-doctor/browser.json", () => {
    expect(sessionFilePath()).toBe(SESSION_FILE);
    expect(sessionDir()).toBe(path.dirname(SESSION_FILE));
  });
});

describe("loadActiveSession", () => {
  it("returns undefined when no session file exists", async () => {
    expect(await loadActiveSession()).toBeUndefined();
  });

  it("returns undefined when the session file is invalid JSON", async () => {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, "{not json", "utf8");

    expect(await loadActiveSession()).toBeUndefined();
  });

  it("returns undefined when required fields are missing", async () => {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ pid: 1, wsUrl: 42 }), "utf8");

    expect(await loadActiveSession()).toBeUndefined();
  });

  it("returns undefined and deletes the file when the recorded pid is dead", async () => {
    writeSession({
      pid: 999_999_999, // PID that is overwhelmingly unlikely to be alive
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      userDataDir: "/tmp/dead-profile",
      tempUserDataDir: undefined,
      startedAt: Date.now(),
    });

    expect(await loadActiveSession()).toBeUndefined();
    expect(fs.existsSync(SESSION_FILE)).toBe(false);
  });

  it("returns the session when the recorded pid is alive", async () => {
    const liveState: BrowserSessionState = {
      pid: process.pid,
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/live",
      userDataDir: "/tmp/live-profile",
      tempUserDataDir: undefined,
      startedAt: 1_700_000_000_000,
    };
    writeSession(liveState);

    const result = await loadActiveSession();
    expect(result).toEqual(liveState);
    expect(fs.existsSync(SESSION_FILE)).toBe(true);
  });
});

describe("stopSession", () => {
  it("returns wasRunning=false and pid=-1 when no session file exists", async () => {
    const result = await stopSession();
    expect(result).toEqual({ pid: -1, wasRunning: false });
  });

  it("removes the session file and the temp profile dir when present", async () => {
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-test-profile-"));
    const sentinelInsideProfile = path.join(tempProfile, "sentinel.txt");
    fs.writeFileSync(sentinelInsideProfile, "x", "utf8");

    writeSession({
      pid: 999_999_999,
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
      userDataDir: tempProfile,
      tempUserDataDir: tempProfile,
      startedAt: Date.now(),
    });

    const result = await stopSession();
    expect(result.pid).toBe(999_999_999);
    expect(result.wasRunning).toBe(false);
    expect(fs.existsSync(SESSION_FILE)).toBe(false);
    expect(fs.existsSync(tempProfile)).toBe(false);
  });

  it("does not touch the user-data dir when tempUserDataDir is undefined (CDP-attached)", async () => {
    const persistentProfile = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-test-persistent-"),
    );

    writeSession({
      pid: 999_999_999,
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/cdp",
      userDataDir: persistentProfile,
      tempUserDataDir: undefined,
      startedAt: Date.now(),
    });

    const result = await stopSession();
    expect(result.wasRunning).toBe(false);
    expect(fs.existsSync(SESSION_FILE)).toBe(false);
    expect(fs.existsSync(persistentProfile)).toBe(true);

    fs.rmSync(persistentProfile, { recursive: true, force: true });
  });
});
