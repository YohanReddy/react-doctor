import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { inspect } from "../src/inspect.js";
import path from "node:path";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";

vi.mock("ora", () => ({
  default: () => ({
    text: "",
    start: function () {
      return this;
    },
    stop: function () {
      return this;
    },
    succeed: () => {},
    fail: () => {},
  }),
}));

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");

interface CapturedFetchCall {
  url: string;
  body: string;
}

const stubScoreFetchAndCapture = (): { captured: CapturedFetchCall[] } => {
  const captured: CapturedFetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ score: 90, label: "Great" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { captured };
};

describe("inspect — score surface filter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("strips `design`-tagged diagnostics before they are sent to the score API", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { captured } = stubScoreFetchAndCapture();

    try {
      const result = await inspect(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        offline: false,
      });

      const scoreCall = captured.find(({ url }) => url.includes("score"));
      expect(scoreCall).toBeDefined();
      const scorePayload: { diagnostics: Array<{ rule: string; plugin: string }> } = JSON.parse(
        scoreCall?.body ?? "{}",
      );

      const hasDesignTag = (ruleId: string): boolean =>
        reactDoctorPlugin.rules[ruleId]?.tags?.includes("design") ?? false;

      const sentDesignDiagnostics = scorePayload.diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor" && hasDesignTag(diagnostic.rule),
      );
      expect(sentDesignDiagnostics).toEqual([]);

      const returnedDesignDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor" && hasDesignTag(diagnostic.rule),
      );
      expect(returnedDesignDiagnostics.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
