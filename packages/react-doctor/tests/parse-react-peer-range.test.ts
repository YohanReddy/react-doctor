import { describe, expect, it } from "vite-plus/test";
import { peerRangeSupportsLegacyReact } from "../src/utils/parse-react-peer-range.js";

describe("peerRangeSupportsLegacyReact", () => {
  it("returns true when the range admits any React major below 19", () => {
    expect(peerRangeSupportsLegacyReact("^17.0.0")).toBe(true);
    expect(peerRangeSupportsLegacyReact("^18.0.0")).toBe(true);
    expect(peerRangeSupportsLegacyReact("^17.0.0 || ^18.0.0 || ^19.0.0")).toBe(true);
    expect(peerRangeSupportsLegacyReact(">=17")).toBe(true);
    expect(peerRangeSupportsLegacyReact(">=16.8.0 <20")).toBe(true);
    expect(peerRangeSupportsLegacyReact("17.x || 18.x || 19.x")).toBe(true);
    expect(peerRangeSupportsLegacyReact("18 || 19")).toBe(true);
  });

  it("returns false when the range only admits React 19+", () => {
    expect(peerRangeSupportsLegacyReact("^19.0.0")).toBe(false);
    expect(peerRangeSupportsLegacyReact("^19.0.0 || ^20.0.0")).toBe(false);
    expect(peerRangeSupportsLegacyReact(">=19")).toBe(false);
    expect(peerRangeSupportsLegacyReact("19.x")).toBe(false);
    expect(peerRangeSupportsLegacyReact("19")).toBe(false);
    expect(peerRangeSupportsLegacyReact("~19.0.0")).toBe(false);
  });

  it("returns false for missing, empty, or non-string input", () => {
    expect(peerRangeSupportsLegacyReact(null)).toBe(false);
    expect(peerRangeSupportsLegacyReact(undefined)).toBe(false);
    expect(peerRangeSupportsLegacyReact("")).toBe(false);
    expect(peerRangeSupportsLegacyReact("   ")).toBe(false);
  });

  it("returns false for tags and workspace protocols (no integers parsed)", () => {
    expect(peerRangeSupportsLegacyReact("latest")).toBe(false);
    expect(peerRangeSupportsLegacyReact("workspace:*")).toBe(false);
    expect(peerRangeSupportsLegacyReact("*")).toBe(false);
  });

  it("ignores 0.x React experimental tags", () => {
    expect(peerRangeSupportsLegacyReact("0.0.0-experimental-abc123")).toBe(false);
    expect(peerRangeSupportsLegacyReact("0.0.0-canary-1a2b3c4d")).toBe(false);
  });

  it("does not double-count `0` patch / minor digits in modern releases", () => {
    expect(peerRangeSupportsLegacyReact("^19.0.0")).toBe(false);
    expect(peerRangeSupportsLegacyReact("19.2.0")).toBe(false);
  });
});
