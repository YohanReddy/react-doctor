export interface Debouncer {
  schedule: () => void;
  cancel: () => void;
}

export const createDebouncer = (callback: () => void, delayMilliseconds: number): Debouncer => {
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      scheduledTimer = setTimeout(() => {
        scheduledTimer = null;
        callback();
      }, delayMilliseconds);
    },
    cancel: () => {
      if (scheduledTimer) clearTimeout(scheduledTimer);
      scheduledTimer = null;
    },
  };
};
