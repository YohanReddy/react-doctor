import { useStdout } from "ink";
import { useEffect, useState } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

const readSize = (stdout: NodeJS.WriteStream | undefined): TerminalSize => ({
  columns: stdout?.columns ?? 80,
  rows: stdout?.rows ?? 24,
});

export const useTerminalSize = (): TerminalSize => {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => readSize(stdout));

  useEffect(() => {
    if (!stdout) return undefined;
    const handleResize = () => setSize(readSize(stdout));
    stdout.on("resize", handleResize);
    handleResize();
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return size;
};
