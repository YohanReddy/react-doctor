import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runBrowser } from "../src/browser";
import { silentLogger } from "../src/logger";
import type { BrowserEngine } from "../src/types";

interface RecordedRequest {
  method: string;
  path: string;
  body: string;
}

const startBrowserApp = async () => {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (request, response) => {
    const path = request.url ?? "/";
    const method = request.method ?? "GET";

    const body = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

    requests.push({ method, path, body });

    if (path === "/api/settings" && method === "POST") {
      const payload = JSON.parse(body) as { workspaceName?: string; activeWorkspace?: string };
      const workspaceName = payload.workspaceName?.trim() || "Untitled workspace";
      const activeWorkspace = payload.activeWorkspace ?? "alpha";

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: `Saved ${workspaceName}`,
          activeWorkspace,
        }),
      );
      return;
    }

    if (path === "/done") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<html><body><h1>Setup complete</h1><p id="done-status">ready for browser tasks</p></body></html>`,
      );
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<html><body>
      <h1>Workspace setup</h1>
      <label for="workspace-name">Workspace name</label>
      <input id="workspace-name" type="text" />
      <section aria-label="Available workspaces">
        <article>
          <h2>Alpha</h2>
          <button type="button" onclick="window.selectWorkspace('alpha')">Open</button>
        </article>
        <article>
          <h2>Beta</h2>
          <button type="button" onclick="window.selectWorkspace('beta')">Open</button>
        </article>
      </section>
      <button id="save" onclick="window.saveSettings()">
        Save settings
      </button>
      <button id="navigate" onclick="setTimeout(() => { window.location.href='/done'; }, 50)">
        Continue
      </button>
      <p id="active-workspace">alpha</p>
      <p id="status">Draft</p>
      <script>
        window.selectWorkspace = (workspaceId) => {
          document.body.dataset.activeWorkspace = workspaceId;
          document.getElementById('active-workspace').textContent = workspaceId;
        };

        window.saveSettings = async () => {
          const workspaceName = document.getElementById('workspace-name').value.trim();
          const activeWorkspace = document.body.dataset.activeWorkspace || 'alpha';
          const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspaceName, activeWorkspace }),
          });
          const result = await response.json();
          document.getElementById('status').textContent = result.status + ' for ' + result.activeWorkspace;
        };
      </script>
    </body></html>`);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve browser test server address"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    requests,
  };
};

describe("browser e2e", () => {
  let server: http.Server;
  let origin: string;
  let requests: RecordedRequest[];

  beforeAll(async () => {
    const app = await startBrowserApp();
    server = app.server;
    origin = app.origin;
    requests = app.requests;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("creates a real page and snapshots interactive content", async () => {
    const session = await runBrowser(
      (browser) => browser.createPage(origin, { waitUntil: "domcontentloaded" }),
      silentLogger,
    );

    try {
      expect(session.page.url()).toBe(`${origin}/`);

      const snapshot = await runBrowser(
        (browser) => browser.snapshot(session.page, { interactive: true }),
        silentLogger,
      );

      expect(snapshot.tree).toContain(`textbox "Workspace name"`);
      expect(snapshot.tree).toContain(`button "Open"`);
      expect(snapshot.tree).toContain(`button "Save settings"`);
      expect(snapshot.tree).toContain(`button "Continue"`);
      expect(snapshot.stats.interactiveRefs).toBeGreaterThanOrEqual(5);
    } finally {
      await session.browser.close();
    }
  });

  it("fills state through Browser.act and preserves the updated value in snapshots", async () => {
    const session = await runBrowser((browser) => browser.createPage(origin), silentLogger);

    try {
      const before = await runBrowser(
        (browser) => browser.snapshot(session.page, { interactive: true }),
        silentLogger,
      );
      const nameRef = Object.keys(before.refs).find(
        (key) => before.refs[key].role === "textbox" && before.refs[key].name === "Workspace name",
      );

      expect(nameRef).toBeDefined();

      const after = await runBrowser(
        (browser) =>
          browser.act(session.page, nameRef!, (locator) => locator.fill("Browser smoke"), {
            interactive: true,
          }),
        silentLogger,
      );

      expect(after.tree).toContain("Browser smoke");
      expect(await session.page.locator("#workspace-name").inputValue()).toBe("Browser smoke");
    } finally {
      await session.browser.close();
    }
  });

  it("resolves duplicate refs and saves settings through a real network roundtrip", async () => {
    requests.length = 0;

    const session = await runBrowser((browser) => browser.createPage(origin), silentLogger);

    try {
      await session.page.locator("#workspace-name").fill("Browser smoke");

      const snapshot = await runBrowser(
        (browser) => browser.snapshot(session.page, { interactive: true }),
        silentLogger,
      );

      const openRefs = Object.entries(snapshot.refs).filter(
        ([, entry]) => entry.role === "button" && entry.name === "Open",
      );
      expect(openRefs).toHaveLength(2);
      expect(openRefs.map(([, entry]) => entry.nth)).toEqual([0, 1]);

      await snapshot.locator(openRefs[1][0]).click();

      expect(await session.page.locator("#active-workspace").textContent()).toBe("beta");

      const saveRef = Object.keys(snapshot.refs).find(
        (key) =>
          snapshot.refs[key].role === "button" && snapshot.refs[key].name === "Save settings",
      );
      expect(saveRef).toBeDefined();

      await snapshot.locator(saveRef!).click();

      await session.page.waitForFunction(
        () => document.getElementById("status")?.textContent === "Saved Browser smoke for beta",
      );
      expect(await session.page.locator("#status").textContent()).toBe(
        "Saved Browser smoke for beta",
      );

      const apiRequest = requests.find((request) => request.path === "/api/settings");
      expect(apiRequest).toBeDefined();
      expect(apiRequest?.method).toBe("POST");
      expect(apiRequest?.body).toContain(`"workspaceName":"Browser smoke"`);
      expect(apiRequest?.body).toContain(`"activeWorkspace":"beta"`);
    } finally {
      await session.browser.close();
    }
  });

  it("supports selector-scoped snapshots for a focused part of the page", async () => {
    const session = await runBrowser((browser) => browser.createPage(origin), silentLogger);

    try {
      const result = await runBrowser(
        (browser) =>
          browser.snapshot(session.page, {
            selector: 'section[aria-label="Available workspaces"]',
            interactive: true,
            compact: true,
          }),
        silentLogger,
      );

      expect(result.tree).toContain(`button "Open"`);
      expect(result.tree).not.toContain(`textbox "Workspace name"`);
      expect(result.stats.interactiveRefs).toBe(2);
    } finally {
      await session.browser.close();
    }
  });

  it("waits for client-side navigation to settle after a click", async () => {
    const session = await runBrowser((browser) => browser.createPage(origin), silentLogger);

    try {
      const urlBefore = session.page.url();

      await session.page.getByRole("button", { name: "Continue" }).click();
      await runBrowser(
        (browser) => browser.waitForNavigationSettle(session.page, urlBefore),
        silentLogger,
      );

      expect(session.page.url()).toBe(`${origin}/done`);

      const snapshot = await runBrowser((browser) => browser.snapshot(session.page), silentLogger);
      expect(snapshot.tree).toContain(`heading "Setup complete"`);
    } finally {
      await session.browser.close();
    }
  });
});

const tryLaunchEngine = async (engineName: BrowserEngine, testOrigin: string) => {
  try {
    return await runBrowser(
      (browser) =>
        browser.createPage(testOrigin, {
          browserType: engineName,
          waitUntil: "domcontentloaded",
        }),
      silentLogger,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // HACK: Playwright bundles browser binaries opt-in. When the user hasn't run
    // `pnpm exec playwright install webkit firefox` (the default in this monorepo),
    // launch throws "Executable doesn't exist". Skip those cases instead of failing.
    if (message.includes("Executable doesn't exist")) return undefined;
    throw error;
  }
};

describe("cross-browser engine support", () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    const app = await startBrowserApp();
    server = app.server;
    origin = app.origin;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("launches webkit and snapshots the page (skipped if WebKit isn't installed)", async () => {
    const session = await tryLaunchEngine("webkit", origin);
    if (!session) return;

    try {
      expect(session.page.url()).toBe(`${origin}/`);

      const snapshot = await runBrowser((browser) => browser.snapshot(session.page), silentLogger);
      expect(snapshot.tree).toContain(`heading "Workspace setup"`);
      expect(snapshot.tree).toContain(`button "Save settings"`);
    } finally {
      await session.browser.close();
    }
  });

  it("launches firefox and snapshots the page (skipped if Firefox isn't installed)", async () => {
    const session = await tryLaunchEngine("firefox", origin);
    if (!session) return;

    try {
      expect(session.page.url()).toBe(`${origin}/`);

      const snapshot = await runBrowser((browser) => browser.snapshot(session.page), silentLogger);
      expect(snapshot.tree).toContain(`heading "Workspace setup"`);
      expect(snapshot.tree).toContain(`button "Save settings"`);
    } finally {
      await session.browser.close();
    }
  });
});
