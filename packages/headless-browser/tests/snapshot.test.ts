import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright";
import { Browser } from "../src/browser";
import { silentLogger } from "../src/logger";

describe("snapshot", () => {
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

  describe("tree and refs", () => {
    it("returns a tree with refs", async () => {
      await page.setContent(`
        <html><body>
          <h1>Hello World</h1>
          <a href="/about">About</a>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      expect(result.tree).toContain("heading");
      expect(result.tree).toContain("Hello World");
      expect(result.tree).toContain("[ref=e1]");
      expect(typeof result.refs).toBe("object");
      expect(Object.keys(result.refs).length).toBeGreaterThan(0);
    });

    it("assigns sequential ref ids", async () => {
      await page.setContent(`
        <html><body>
          <button>First</button>
          <button>Second</button>
          <button>Third</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      expect(result.refs.e1).toBeDefined();
      expect(result.refs.e2).toBeDefined();
      expect(result.refs.e3).toBeDefined();
    });

    it("stores role and name in refs", async () => {
      await page.setContent(`
        <html><body>
          <button>Submit</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const buttonRef = Object.values(result.refs).find((entry) => entry.name === "Submit");
      expect(buttonRef).toBeDefined();
      expect(buttonRef?.role).toBe("button");
    });
  });

  describe("nth disambiguation", () => {
    it("sets nth on duplicate role+name entries", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
          <button>OK</button>
          <button>Cancel</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const okButtons = Object.values(result.refs).filter(
        (entry) => entry.role === "button" && entry.name === "OK",
      );
      expect(okButtons.length).toBe(2);
      expect(okButtons[0].nth).toBe(0);
      expect(okButtons[1].nth).toBe(1);
    });

    it("does not set nth on unique role+name entries", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
          <button>Cancel</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      for (const entry of Object.values(result.refs)) {
        expect(entry.nth).toBeUndefined();
      }
    });
  });

  describe("locator", () => {
    it("resolves ref to a working locator", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <button>Click Me</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const buttonRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].name === "Click Me",
      );
      expect(buttonRefKey).toBeDefined();

      const locator = result.locator(buttonRefKey!);
      const text = await locator.textContent();
      expect(text).toBe("Click Me");
    });

    it("throws RefNotFoundError on unknown ref with available refs", async () => {
      await page.setContent(`
        <html><body>
          <button>OK</button>
        </body></html>
      `);
      const result = await browser.snapshot(page);
      expect(() => result.locator("nonexistent")).toThrow("available refs: e1");
    });

    it("throws RefNotFoundError with empty page hint on bare page", async () => {
      await page.setContent("<html><body></body></html>");
      const result = await browser.snapshot(page);
      expect(() => result.locator("e1")).toThrow("no refs available");
    });

    it("clicks the correct element via ref", async () => {
      await page.setContent(`
        <html><body>
          <button onclick="document.title='clicked'">Click Me</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const buttonRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].name === "Click Me",
      );
      await result.locator(buttonRefKey!).click();
      expect(await page.title()).toBe("clicked");
    });

    it("clicks the correct duplicate button via nth", async () => {
      await page.setContent(`
        <html><body>
          <button onclick="document.title='first'">OK</button>
          <button onclick="document.title='second'">OK</button>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const okButtons = Object.entries(result.refs).filter(
        ([, entry]) => entry.role === "button" && entry.name === "OK",
      );
      expect(okButtons.length).toBe(2);

      await result.locator(okButtons[1][0]).click();
      expect(await page.title()).toBe("second");
    });

    it("fills an input via ref", async () => {
      await page.setContent(`
        <html><body>
          <label for="email">Email</label>
          <input id="email" type="text" />
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const inputRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].role === "textbox",
      );
      expect(inputRefKey).toBeDefined();

      await result.locator(inputRefKey!).fill("test@example.com");
      const value = await page.locator("#email").inputValue();
      expect(value).toBe("test@example.com");
    });

    it("selects an option via ref", async () => {
      await page.setContent(`
        <html><body>
          <label for="color">Color</label>
          <select id="color">
            <option value="red">Red</option>
            <option value="blue">Blue</option>
          </select>
        </body></html>
      `);

      const result = await browser.snapshot(page);
      const selectRefKey = Object.keys(result.refs).find(
        (key) => result.refs[key].role === "combobox",
      );
      expect(selectRefKey).toBeDefined();

      await result.locator(selectRefKey!).selectOption("blue");
      const value = await page.locator("#color").inputValue();
      expect(value).toBe("blue");
    });
  });

  describe("timeout", () => {
    it("accepts a custom timeout", async () => {
      await page.setContent("<html><body><p>Hello</p></body></html>");
      const result = await browser.snapshot(page, { timeout: 5000 });
      expect(result.tree).toContain("paragraph");
    });
  });

  describe("interactive filter", () => {
    it("only includes interactive elements", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <p>Description</p>
          <button>Submit</button>
          <a href="/link">Link</a>
          <input type="text" placeholder="Name" />
        </body></html>
      `);

      const result = await browser.snapshot(page, { interactive: true });
      const roles = Object.values(result.refs).map((entry) => entry.role);
      expect(roles).toContain("button");
      expect(roles).toContain("link");
      expect(roles).toContain("textbox");
      expect(roles).not.toContain("heading");
      expect(roles).not.toContain("paragraph");
    });

    it("returns the no-interactive-elements message for a static page", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <p>Just text</p>
        </body></html>
      `);

      const result = await browser.snapshot(page, { interactive: true });
      expect(result.tree).toBe("(no interactive elements)");
      expect(Object.keys(result.refs).length).toBe(0);
    });

    it("excludes non-interactive tree lines", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <button>OK</button>
        </body></html>
      `);

      const result = await browser.snapshot(page, { interactive: true });
      expect(result.tree).not.toContain("heading");
      expect(result.tree).toContain("button");
    });
  });

  describe("compact filter", () => {
    it("removes empty structural nodes without refs", async () => {
      await page.setContent(`
        <html><body>
          <div>
            <div>
              <button>Deep</button>
            </div>
          </div>
        </body></html>
      `);

      const full = await browser.snapshot(page);
      const compacted = await browser.snapshot(page, { compact: true });
      expect(compacted.tree.split("\n").length).toBeLessThanOrEqual(full.tree.split("\n").length);
      expect(compacted.tree).toContain("button");
      expect(compacted.tree).toContain("[ref=");
    });

    it("keeps structural parents of ref-bearing children", async () => {
      await page.setContent(`
        <html><body>
          <nav>
            <a href="/home">Home</a>
            <a href="/about">About</a>
          </nav>
        </body></html>
      `);

      const result = await browser.snapshot(page, { compact: true });
      expect(result.tree).toContain("navigation");
      expect(result.tree).toContain("link");
    });
  });

  describe("maxDepth filter", () => {
    it("limits tree depth", async () => {
      await page.setContent(`
        <html><body>
          <nav>
            <ul>
              <li><a href="/home">Home</a></li>
              <li><a href="/about">About</a></li>
            </ul>
          </nav>
        </body></html>
      `);

      const shallow = await browser.snapshot(page, { maxDepth: 1 });
      const deep = await browser.snapshot(page);
      expect(shallow.tree.split("\n").length).toBeLessThan(deep.tree.split("\n").length);
    });

    it("returns top-level elements only at depth 0", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <nav>
            <a href="/link">Link</a>
          </nav>
        </body></html>
      `);

      const result = await browser.snapshot(page, { maxDepth: 0 });
      for (const line of result.tree.split("\n")) {
        if (line.trim()) {
          expect(line).toMatch(/^- /);
        }
      }
    });
  });

  describe("combined filters", () => {
    it("applies interactive and compact together", async () => {
      await page.setContent(`
        <html><body>
          <h1>Title</h1>
          <div>
            <div>
              <button>Submit</button>
            </div>
          </div>
          <p>Footer text</p>
        </body></html>
      `);

      const result = await browser.snapshot(page, { interactive: true, compact: true });
      expect(result.tree).toContain("button");
      expect(result.tree).not.toContain("heading");
      expect(result.tree).not.toContain("paragraph");
      expect(Object.keys(result.refs).length).toBe(1);
    });

    it("applies interactive and maxDepth together", async () => {
      await page.setContent(`
        <html><body>
          <nav>
            <ul>
              <li><a href="/home">Home</a></li>
            </ul>
          </nav>
          <button>Top</button>
        </body></html>
      `);

      const result = await browser.snapshot(page, { interactive: true, maxDepth: 0 });
      const roles = Object.values(result.refs).map((entry) => entry.role);
      expect(roles).toContain("button");
      expect(roles).not.toContain("link");
    });
  });

  describe("diverse interactive roles", () => {
    it("handles radio buttons", async () => {
      await page.setContent(
        `<html><body><fieldset><legend>Size</legend><label><input type="radio" name="size" value="s" /> Small</label><label><input type="radio" name="size" value="m" /> Medium</label></fieldset></body></html>`,
      );
      const result = await browser.snapshot(page, { interactive: true });
      expect(Object.values(result.refs).map((entry) => entry.role)).toContain("radio");
    });

    it("handles checkboxes", async () => {
      await page.setContent(
        `<html><body><label><input type="checkbox" /> Accept terms</label></body></html>`,
      );
      const result = await browser.snapshot(page, { interactive: true });
      expect(Object.values(result.refs).map((entry) => entry.role)).toContain("checkbox");
    });

    it("handles searchbox", async () => {
      await page.setContent(
        `<html><body><input type="search" aria-label="Search" /></body></html>`,
      );
      const result = await browser.snapshot(page, { interactive: true });
      expect(Object.values(result.refs).map((entry) => entry.role)).toContain("searchbox");
    });

    it("handles spinbutton", async () => {
      await page.setContent(
        `<html><body><label for="qty">Quantity</label><input id="qty" type="number" /></body></html>`,
      );
      const result = await browser.snapshot(page, { interactive: true });
      expect(Object.values(result.refs).map((entry) => entry.role)).toContain("spinbutton");
    });
  });

  describe("edge cases", () => {
    it("handles a completely empty body", async () => {
      await page.setContent("<html><body></body></html>");
      const result = await browser.snapshot(page);
      expect(Object.keys(result.refs).length).toBe(0);
    });

    it("handles aria-label overriding visible text", async () => {
      await page.setContent(
        `<html><body><button aria-label="Close dialog">X</button></body></html>`,
      );
      const result = await browser.snapshot(page);
      const entry = Object.values(result.refs).find((ref) => ref.role === "button");
      expect(entry?.name).toBe("Close dialog");
    });

    it("produces consistent refs for the same content", async () => {
      await page.setContent(`<html><body><button>A</button><button>B</button></body></html>`);
      const first = await browser.snapshot(page);
      const second = await browser.snapshot(page);
      expect(first.refs).toEqual(second.refs);
    });
  });
});
