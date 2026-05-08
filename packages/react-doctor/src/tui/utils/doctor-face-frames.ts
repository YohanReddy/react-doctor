import type { DoctorMood } from "../types.js";

export interface DoctorFaceFrame {
  eyes: string;
  mouth: string;
}

// Each frame's `eyes` and `mouth` MUST be exactly 5 characters wide so
// that `│{frame.eyes}│` and `│{frame.mouth}│` render as identical
// 7-character rows beneath the `┌─────┐` / `└─────┘` borders. A
// width mismatch here was the cause of the "first 1-2 lines show
// double" rendering glitch — Ink reuses ANSI cursor moves to redraw,
// and a shorter row leaves stale chars from the previous frame.

const SCANNING_FRAMES: DoctorFaceFrame[] = [
  { eyes: " ◠ ◠ ", mouth: "  ─  " },
  { eyes: " ◠ ◠ ", mouth: "  ◡  " },
  { eyes: " ◡ ◡ ", mouth: "  ◡  " },
  { eyes: " ◠ ◠ ", mouth: "  ◡  " },
];

const GREAT_FRAMES: DoctorFaceFrame[] = [
  { eyes: " ◠ ◠ ", mouth: "  ▽  " },
  { eyes: " ◠ ◠ ", mouth: "  ◡  " },
];

const OK_FRAMES: DoctorFaceFrame[] = [
  { eyes: " • • ", mouth: "  ─  " },
  { eyes: " - - ", mouth: "  ─  " },
];

const BAD_FRAMES: DoctorFaceFrame[] = [
  { eyes: " x x ", mouth: "  ▽  " },
  { eyes: " × × ", mouth: "  ▽  " },
];

const NEUTRAL_FRAMES: DoctorFaceFrame[] = [{ eyes: " • • ", mouth: "  ─  " }];

const ERROR_FRAMES: DoctorFaceFrame[] = [
  { eyes: " @ @ ", mouth: "  ▼  " },
  { eyes: " @ @ ", mouth: "  ─  " },
];

const FRAMES_BY_MOOD: Record<DoctorMood, DoctorFaceFrame[]> = {
  scanning: SCANNING_FRAMES,
  great: GREAT_FRAMES,
  ok: OK_FRAMES,
  bad: BAD_FRAMES,
  neutral: NEUTRAL_FRAMES,
  error: ERROR_FRAMES,
};

const BLINK_FRAME: DoctorFaceFrame = { eyes: " ◡ ◡ ", mouth: "  ◡  " };

export const getDoctorFrame = (mood: DoctorMood, frameIndex: number): DoctorFaceFrame => {
  const frames = FRAMES_BY_MOOD[mood];
  return frames[frameIndex % frames.length];
};

export const getBlinkFrame = (): DoctorFaceFrame => BLINK_FRAME;

export const DOCTOR_FACE_INNER_WIDTH = 5;
