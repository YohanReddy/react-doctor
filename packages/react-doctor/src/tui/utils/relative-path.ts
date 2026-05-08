import path from "node:path";

export const toRelativePath = (filePath: string, rootDirectory: string): string => {
  if (!path.isAbsolute(filePath)) return filePath;
  const relative = path.relative(rootDirectory, filePath);
  if (relative.length === 0) return path.basename(filePath);
  if (relative.startsWith("..")) return filePath;
  return relative;
};
