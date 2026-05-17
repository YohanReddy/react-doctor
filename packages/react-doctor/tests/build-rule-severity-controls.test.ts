import { describe, expect, it } from "vite-plus/test";
import type { ReactDoctorConfig } from "@react-doctor/types";
import { buildRuleSeverityControls } from "@react-doctor/core";

describe("buildRuleSeverityControls", () => {
  it("returns undefined for a null config", () => {
    expect(buildRuleSeverityControls(null)).toBeUndefined();
  });

  it("returns undefined when none of `rules` / `categories` / `tags` are set", () => {
    const config: ReactDoctorConfig = { verbose: true };
    expect(buildRuleSeverityControls(config)).toBeUndefined();
  });

  it("assembles a controls object from the three top-level fields", () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/no-array-index-as-key": "error" },
      categories: { "React Native": "warn" },
      tags: { design: "off" },
    };
    expect(buildRuleSeverityControls(config)).toEqual({
      rules: { "react-doctor/no-array-index-as-key": "error" },
      categories: { "React Native": "warn" },
      tags: { design: "off" },
    });
  });

  it("omits unset channels (doesn't fabricate empty maps)", () => {
    const config: ReactDoctorConfig = { tags: { design: "off" } };
    expect(buildRuleSeverityControls(config)).toEqual({ tags: { design: "off" } });
  });
});
