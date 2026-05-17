import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveTabindex } from "./no-noninteractive-tabindex.js";
import { tabindexNoPositive } from "./tabindex-no-positive.js";

describe("a11y tabindex parsing regressions", () => {
  it("uses the alternate branch for statically false conditional tabIndex values", () => {
    const positiveResult = runRule(tabindexNoPositive, `<div tabIndex={false ? 1 : 0} />`);
    const noninteractiveResult = runRule(
      noNoninteractiveTabindex,
      `<div tabIndex={false ? -1 : 0} />`,
    );

    expect(positiveResult.diagnostics).toEqual([]);
    expect(noninteractiveResult.diagnostics).toHaveLength(1);
  });
});
