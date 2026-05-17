import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoUndef } from "./jsx-no-undef.js";

describe("react-builtins/jsx-no-undef regressions", () => {
  it("does not treat type-only declarations as runtime JSX bindings", () => {
    const result = runRule(
      jsxNoUndef,
      `
        interface Foo {}
        type Bar = {};
        const App = () => <><Foo /><Bar /></>;
      `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });
});
