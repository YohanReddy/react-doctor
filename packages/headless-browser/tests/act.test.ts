import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright";
import { Browser } from "../src/browser";
import { silentLogger } from "../src/logger";

describe("act", () => {
  let playwrightBrowser: PlaywrightBrowser;
  let page: Page;
  const browser = new Browser(silentLogger);

  beforeAll(async () => {
    playwrightBrowser = await chromium.launch({ headless: true });
    const context = await playwrightBrowser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await playwrightBrowser.close();
  });

  it("performs a click action and returns an updated snapshot", async () => {
    await page.setContent(
      `<html><body><button onclick="this.textContent='Clicked!'">Click Me</button></body></html>`,
    );

    const before = await browser.snapshot(page);
    const buttonRef = Object.keys(before.refs).find((key) => before.refs[key].name === "Click Me");
    expect(buttonRef).toBeDefined();

    const after = await browser.act(page, buttonRef!, (locator) => locator.click());
    expect(after.tree).toContain("Clicked!");
  });

  it("performs a fill action and returns an updated snapshot", async () => {
    await page.setContent(
      `<html><body><label for="name">Name</label><input id="name" type="text" /></body></html>`,
    );

    const before = await browser.snapshot(page);
    const inputRef = Object.keys(before.refs).find((key) => before.refs[key].role === "textbox");
    expect(inputRef).toBeDefined();

    const after = await browser.act(page, inputRef!, (locator) => locator.fill("Alice"));
    expect(after.tree).toContain("Alice");
  });

  it("toggles a checkbox via act", async () => {
    await page.setContent(
      `<html><body><input type="checkbox" aria-label="Accept terms" /></body></html>`,
    );

    const before = await browser.snapshot(page);
    const checkboxRef = Object.keys(before.refs).find(
      (key) => before.refs[key].role === "checkbox",
    );
    expect(checkboxRef).toBeDefined();

    await browser.act(page, checkboxRef!, (locator) => locator.check());
    const isChecked = await page.locator('[aria-label="Accept terms"]').isChecked();
    expect(isChecked).toBe(true);
  });

  it("returns a snapshot with valid refs after the action mutates the DOM", async () => {
    await page.setContent(
      `<html><body><button onclick="document.body.innerHTML='<a href=\\'/new\\'>New Link</a>'">Replace</button></body></html>`,
    );

    const before = await browser.snapshot(page);
    const buttonRef = Object.keys(before.refs).find((key) => before.refs[key].role === "button");
    expect(buttonRef).toBeDefined();

    const after = await browser.act(page, buttonRef!, (locator) => locator.click());
    expect(after.tree).toContain("link");
    expect(after.tree).toContain("New Link");

    const linkRef = Object.keys(after.refs).find((key) => after.refs[key].role === "link");
    expect(linkRef).toBeDefined();

    expect(await after.locator(linkRef!).textContent()).toBe("New Link");
  });

  it("forwards snapshot options to the post-action snapshot", async () => {
    await page.setContent(
      `<html><body><h1>Title</h1><button onclick="this.textContent='Done'">Action</button></body></html>`,
    );

    const interactiveBefore = await browser.snapshot(page, { interactive: true });
    const buttonRef = Object.keys(interactiveBefore.refs).find(
      (key) => interactiveBefore.refs[key].role === "button",
    );
    expect(buttonRef).toBeDefined();

    const after = await browser.act(page, buttonRef!, (locator) => locator.click(), {
      interactive: true,
    });

    const roles = Object.values(after.refs).map((entry) => entry.role);
    expect(roles).not.toContain("heading");
    expect(roles).toContain("button");
  });

  it("handles actions on duplicate-named elements", async () => {
    await page.setContent(
      `<html><body><button onclick="document.title='first'">Go</button><button onclick="document.title='second'">Go</button></body></html>`,
    );

    const before = await browser.snapshot(page);
    const goButtons = Object.entries(before.refs).filter(
      ([, entry]) => entry.role === "button" && entry.name === "Go",
    );
    expect(goButtons.length).toBe(2);

    await browser.act(page, goButtons[1][0], (locator) => locator.click());
    expect(await page.title()).toBe("second");
  });

  it("handles a select-option action", async () => {
    await page.setContent(
      `<html><body><label for="fruit">Fruit</label><select id="fruit"><option value="apple">Apple</option><option value="banana">Banana</option></select></body></html>`,
    );

    const before = await browser.snapshot(page);
    const selectRef = Object.keys(before.refs).find((key) => before.refs[key].role === "combobox");
    expect(selectRef).toBeDefined();

    await browser.act(page, selectRef!, async (locator) => {
      await locator.selectOption("banana");
    });
    const value = await page.locator("#fruit").inputValue();
    expect(value).toBe("banana");
  });
});
