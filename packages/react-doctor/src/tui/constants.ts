export const PERFECT_SCORE = 100;

export const SCORE_GOOD_THRESHOLD = 75;

export const SCORE_OK_THRESHOLD = 50;

export const SCORE_BAR_WIDTH_CHARS = 36;

export const DOCTOR_FACE_BLINK_INTERVAL_MS = 3200;

export const DOCTOR_FACE_BLINK_HOLD_MS = 140;

// HACK: 480ms is a deliberately slow scanning-frame interval. Faster
// rates (we used 240ms originally) made Ink's incremental redraw
// double-print the doctor's top borders on slow / partial-line TTYs.
export const DOCTOR_FACE_FRAME_INTERVAL_MS = 480;

export const DOCTOR_FACE_INNER_WIDTH_CHARS = 5;

export const DOCTOR_FACE_HEIGHT_LINES = 4;

export const NARROW_LAYOUT_BREAKPOINT_COLS = 90;

export const VERY_NARROW_LAYOUT_BREAKPOINT_COLS = 60;

export const HEALTH_TILE_MIN_WIDTH_COLS = 28;

export const TOP_ISSUES_LIMIT = 5;

export const SCAN_SUMMARY_FOOTER_HEIGHT_LINES = 1;

export const SCAN_DEBOUNCE_MS = 250;

export const WATCH_RESCAN_DEBOUNCE_MS = 350;

export const STATUS_PULSE_INTERVAL_MS = 700;

export const SCORE_TWEEN_DURATION_MS = 600;

export const SCORE_TWEEN_FRAME_INTERVAL_MS = 32;

export const RECENT_SCORE_HISTORY_LIMIT = 16;

export const DIAGNOSTIC_LIST_VIEWPORT_ROWS = 14;

export const SOURCE_SNIPPET_CONTEXT_LINES = 3;

export const MILLISECONDS_PER_SECOND = 1000;

export const FPS_BUDGET_MS = 16;

export const APP_TITLE = "React Doctor";

export const APP_SUBTITLE = "react.doctor";
