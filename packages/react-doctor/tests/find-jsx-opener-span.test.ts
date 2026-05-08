import { describe, expect, it } from "vite-plus/test";
import { findJsxOpenerSpan } from "../src/utils/find-jsx-opener-span.js";

describe("findJsxOpenerSpan", () => {
  it("returns the opener line itself for a single-line tag", () => {
    expect(findJsxOpenerSpan(["<div />"], 0)).toBe(0);
    expect(findJsxOpenerSpan(['<Component prop="x" />'], 0)).toBe(0);
  });

  it("returns null when the line has no JSX opener tag", () => {
    expect(findJsxOpenerSpan(["const x = 1;"], 0)).toBeNull();
    expect(findJsxOpenerSpan(["// comment about <Foo>"], 0)).not.toBeNull();
  });

  it("walks across lines to find the closing > of a multi-line opener", () => {
    const lines = ["<li", "  key={x}", '  role="button"', ">", "  text", "</li>"];
    expect(findJsxOpenerSpan(lines, 0)).toBe(3);
  });

  it("ignores > inside `{...}` expressions while scanning for the close", () => {
    const lines = ["<Banner", "  show={count > 0}", "  onClick={() => doStuff()}", "/>"];
    expect(findJsxOpenerSpan(lines, 0)).toBe(3);
  });

  it("ignores > inside string attributes", () => {
    const lines = ["<Banner", '  title="2 > 1"', "/>"];
    expect(findJsxOpenerSpan(lines, 0)).toBe(2);
  });

  it("skips the > of `=>` arrow operators", () => {
    const lines = ["<Banner", "  onClick={() => 42}", "/>"];
    expect(findJsxOpenerSpan(lines, 0)).toBe(2);
  });

  it("respects the lookahead cap (returns null when the close is nowhere)", () => {
    const truncatedOpenerLines = ["<Banner", ...Array(80).fill("  attribute={value}")];
    expect(findJsxOpenerSpan(truncatedOpenerLines, 0)).toBeNull();
  });

  it("returns null for closing tags (no opener match)", () => {
    expect(findJsxOpenerSpan(["</li>"], 0)).toBeNull();
  });
});
