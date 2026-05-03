import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright";
import { createLocator } from "../src/utils/create-locator";
import { resolveLocator } from "../src/utils/resolve-locator";
import type { RefMap } from "../src/types";

describe("resolveLocator", () => {
  let playwrightBrowser: PlaywrightBrowser;
  let page: Page;

  beforeAll(async () => {
    playwrightBrowser = await chromium.launch({ headless: true });
    const context = await playwrightBrowser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await playwrightBrowser.close();
  });

  it("resolves a locator by role and name", async () => {
    await page.setContent(`
      <html><body>
        <button>Submit</button>
      </body></html>
    `);

    const locator = resolveLocator(page, { role: "button", name: "Submit" });
    expect(await locator.count()).toBe(1);
    expect(await locator.textContent()).toBe("Submit");
  });

  it("resolves the correct locator when nth is specified", async () => {
    await page.setContent(`
      <html><body>
        <button>OK</button>
        <button>OK</button>
      </body></html>
    `);

    const first = resolveLocator(page, { role: "button", name: "OK", nth: 0 });
    const second = resolveLocator(page, { role: "button", name: "OK", nth: 1 });

    expect(await first.count()).toBe(1);
    expect(await second.count()).toBe(1);
  });

  it("matches name exactly", async () => {
    await page.setContent(`
      <html><body>
        <button>Submit Form</button>
        <button>Submit</button>
      </body></html>
    `);

    const locator = resolveLocator(page, { role: "button", name: "Submit" });
    expect(await locator.count()).toBe(1);
    expect(await locator.textContent()).toBe("Submit");
  });

  it("resolves elements with empty name", async () => {
    await page.setContent(`
      <html><body>
        <button></button>
      </body></html>
    `);

    const locator = resolveLocator(page, { role: "button", name: "" });
    expect(await locator.count()).toBe(1);
  });

  it("resolves different role types", async () => {
    await page.setContent(`
      <html><body>
        <a href="/home">Home</a>
        <input type="checkbox" aria-label="Agree" />
        <h1>Title</h1>
      </body></html>
    `);

    const link = resolveLocator(page, { role: "link", name: "Home" });
    const checkbox = resolveLocator(page, { role: "checkbox", name: "Agree" });
    const heading = resolveLocator(page, { role: "heading", name: "Title" });

    expect(await link.count()).toBe(1);
    expect(await checkbox.count()).toBe(1);
    expect(await heading.count()).toBe(1);
  });

  it("uses an explicit selector when present", async () => {
    await page.setContent(`
      <html><body>
        <div id="custom">custom</div>
      </body></html>
    `);

    const locator = resolveLocator(page, { role: "generic", name: "", selector: "#custom" });
    expect(await locator.count()).toBe(1);
    expect(await locator.textContent()).toBe("custom");
  });
});

describe("createLocator", () => {
  let playwrightBrowser: PlaywrightBrowser;
  let page: Page;

  beforeAll(async () => {
    playwrightBrowser = await chromium.launch({ headless: true });
    const context = await playwrightBrowser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await playwrightBrowser.close();
  });

  it("returns a function that resolves refs", async () => {
    await page.setContent(`
      <html><body>
        <button>Click</button>
      </body></html>
    `);

    const refs: RefMap = {
      e1: { role: "button", name: "Click" },
    };
    const locate = createLocator(page, refs);
    expect(await locate("e1").count()).toBe(1);
  });

  it("throws RefNotFoundError listing available refs on unknown ref", async () => {
    const refs: RefMap = {
      e1: { role: "button", name: "A" },
      e2: { role: "link", name: "B" },
    };
    const locate = createLocator(page, refs);

    expect(() => locate("e99")).toThrow('Unknown ref "e99"');
    expect(() => locate("e99")).toThrow("available refs: e1, e2");
  });

  it("throws RefNotFoundError with the empty-page hint when no refs exist", async () => {
    const refs: RefMap = {};
    const locate = createLocator(page, refs);

    expect(() => locate("e1")).toThrow("no refs available");
    expect(() => locate("e1")).toThrow("page may be empty");
  });

  it("resolves nth-disambiguated refs correctly", async () => {
    await page.setContent(`
      <html><body>
        <button onclick="document.title='first'">OK</button>
        <button onclick="document.title='second'">OK</button>
      </body></html>
    `);

    const refs: RefMap = {
      e1: { role: "button", name: "OK", nth: 0 },
      e2: { role: "button", name: "OK", nth: 1 },
    };
    const locate = createLocator(page, refs);

    await locate("e2").click();
    expect(await page.title()).toBe("second");

    await locate("e1").click();
    expect(await page.title()).toBe("first");
  });
});
