// eslint-disable-next-line no-control-regex -- intentionally strips ANSI escape sequences from rendered Ink output for snapshot assertions
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

export const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_PATTERN, "");
