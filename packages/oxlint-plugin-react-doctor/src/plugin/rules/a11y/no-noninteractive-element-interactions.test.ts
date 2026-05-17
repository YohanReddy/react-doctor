import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveElementInteractions } from "./no-noninteractive-element-interactions.js";

describe("a11y/no-noninteractive-element-interactions", () => {
  it("reports handlers on non-interactive elements with presentation roles", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<article role="presentation" onClick={() => {}}>Open</article>`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows handlers when the element has an interactive role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<article role="button" onClick={() => {}}>Open</article>`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
