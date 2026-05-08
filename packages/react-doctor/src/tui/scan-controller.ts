import { scan } from "../scan.js";
import type { ScanEvent, ScanOptions } from "../types.js";

export interface ScanControllerEvent {
  type: "started" | "event" | "finished" | "failed";
  event?: ScanEvent;
  error?: Error;
}

export type ScanControllerListener = (controllerEvent: ScanControllerEvent) => void;

export interface RunScanArguments {
  directory: string;
  options: ScanOptions;
  listener: ScanControllerListener;
}

export const runScanWithListener = async ({
  directory,
  options,
  listener,
}: RunScanArguments): Promise<void> => {
  listener({ type: "started" });
  try {
    await scan(directory, {
      ...options,
      silent: true,
      reporter: {
        emit: (event: ScanEvent) => listener({ type: "event", event }),
      },
    });
    listener({ type: "finished" });
  } catch (scanError) {
    listener({
      type: "failed",
      error: scanError instanceof Error ? scanError : new Error(String(scanError)),
    });
  }
};
