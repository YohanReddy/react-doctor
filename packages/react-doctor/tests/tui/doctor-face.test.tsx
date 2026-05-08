import { describe, expect, it } from "vite-plus/test";
import { render } from "ink-testing-library";
import { DoctorFace } from "../../src/tui/components/doctor-face.js";
import { getBlinkFrame, getDoctorFrame } from "../../src/tui/utils/doctor-face-frames.js";
import type { DoctorMood } from "../../src/tui/types.js";

import { stripAnsi } from "./strip-ansi.js";

const linesOf = (frame: string): string[] => frame.split("\n");

describe("doctor face frame data", () => {
  const moods: DoctorMood[] = ["scanning", "great", "ok", "bad", "neutral", "error"];

  it("keeps eyes and mouth a consistent 5-character inner width across every mood and frame index", () => {
    for (const mood of moods) {
      for (let frameIndex = 0; frameIndex < 8; frameIndex++) {
        const frame = getDoctorFrame(mood, frameIndex);
        expect(frame.eyes.length, `mood ${mood} frame ${frameIndex} eyes`).toBe(5);
        expect(frame.mouth.length, `mood ${mood} frame ${frameIndex} mouth`).toBe(5);
      }
    }
  });

  it("returns a 5-character blink frame", () => {
    const blink = getBlinkFrame();
    expect(blink.eyes.length).toBe(5);
    expect(blink.mouth.length).toBe(5);
  });
});

describe("DoctorFace rendering", () => {
  it("produces a 4-line box whose eye and mouth rows have the same width as the borders", () => {
    const { lastFrame, unmount } = render(<DoctorFace mood="great" isAnimating={false} />);
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = linesOf(frame).filter((line) => line.length > 0);
    expect(lines.length).toBe(4);
    const widths = lines.map((line) => Array.from(line).length);
    expect(widths.every((width) => width === widths[0])).toBe(true);
    expect(widths[0]).toBe(7);
    expect(lines[0]).toBe("┌─────┐");
    expect(lines[3]).toBe("└─────┘");
    unmount();
  });

  it("renders cleanly while animating (no shorter rows that would leave stale chars)", () => {
    const { lastFrame, unmount } = render(<DoctorFace mood="scanning" isAnimating />);
    const frame = stripAnsi(lastFrame() ?? "");
    const lines = linesOf(frame).filter((line) => line.length > 0);
    expect(lines.length).toBe(4);
    const widths = lines.map((line) => Array.from(line).length);
    expect(widths.every((width) => width === 7)).toBe(true);
    unmount();
  });

  it("uses a different mood color per status without changing line widths", () => {
    for (const mood of ["great", "ok", "bad", "error", "neutral"] as DoctorMood[]) {
      const { lastFrame, unmount } = render(<DoctorFace mood={mood} isAnimating={false} />);
      const frame = stripAnsi(lastFrame() ?? "");
      const lines = linesOf(frame).filter((line) => line.length > 0);
      expect(lines.every((line) => Array.from(line).length === 7)).toBe(true);
      unmount();
    }
  });
});
