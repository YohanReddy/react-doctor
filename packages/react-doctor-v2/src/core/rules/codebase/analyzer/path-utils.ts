import path from "node:path";
import {
  POSITION_BASE_OFFSET,
  SOURCE_FILE_EXTENSIONS,
  TYPESCRIPT_DECLARATION_EXTENSIONS,
} from "./constants.js";
import type { SourcePosition } from "./types.js";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const toPortablePath = (filePath: string): string => filePath.split(path.sep).join("/");

export const toRelativePath = (rootDirectory: string, filePath: string): string =>
  toPortablePath(path.relative(rootDirectory, filePath));

export const isSourceFilePath = (filePath: string): boolean =>
  SOURCE_FILE_EXTENSIONS.some((extension) => filePath.endsWith(extension)) &&
  !TYPESCRIPT_DECLARATION_EXTENSIONS.some((extension) => filePath.endsWith(extension));

export const buildLineStarts = (sourceText: string): number[] => {
  const lineStarts = [0];
  for (let index = 0; index < sourceText.length; index++) {
    if (sourceText[index] === "\n") lineStarts.push(index + 1);
  }
  return lineStarts;
};

export const getSourcePositionFromLineStarts = (
  lineStarts: number[],
  index: number,
): SourcePosition => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (index < lineStart) high = middle - 1;
    else if (index >= nextLineStart) low = middle + 1;
    else {
      return {
        line: middle + POSITION_BASE_OFFSET,
        column: index - lineStart + POSITION_BASE_OFFSET,
      };
    }
  }
  return {
    line: POSITION_BASE_OFFSET,
    column: POSITION_BASE_OFFSET,
  };
};

export const getSourcePosition = (sourceText: string, index: number): SourcePosition =>
  getSourcePositionFromLineStarts(buildLineStarts(sourceText), index);

export const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("/") &&
  !specifier.startsWith("#") &&
  !/^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier);

export const isUrlLikeSpecifier = (specifier: string): boolean =>
  /^[A-Za-z][A-Za-z\d+.-]*:/.test(specifier);

export const getPackageNameFromSpecifier = (specifier: string): string | null => {
  if (!isBareSpecifier(specifier)) return null;
  const parts = specifier.split("/");
  const firstPart = parts[0];
  if (!firstPart) return null;
  if (firstPart.startsWith("@")) {
    const secondPart = parts[1];
    return secondPart ? `${firstPart}/${secondPart}` : firstPart;
  }
  return firstPart;
};

export const getFileStem = (relativePath: string): string => {
  const basename = path.basename(relativePath);
  for (const extension of SOURCE_FILE_EXTENSIONS) {
    if (basename.endsWith(extension)) {
      return basename.slice(0, -extension.length);
    }
  }
  return basename;
};

export const createGlobMatcher = (pattern: string): RegExp => {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    const nextCharacter = pattern[index + 1];
    const characterAfterNext = pattern[index + 2];
    if (character === "*" && nextCharacter === "*" && characterAfterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (character === "*" && nextCharacter === "*") {
      source += ".*";
      index++;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "{") {
      const endIndex = pattern.indexOf("}", index);
      if (endIndex > index) {
        source += `(${pattern
          .slice(index + 1, endIndex)
          .split(",")
          .map(escapeRegExp)
          .join("|")})`;
        index = endIndex;
      } else {
        source += "\\{";
      }
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`^${source}$`);
};

export const matchesGlob = (relativePath: string, pattern: string): boolean =>
  createGlobMatcher(pattern).test(relativePath);

export const matchesAnyGlob = (relativePath: string, patterns: string[]): boolean =>
  patterns.some((pattern) => matchesGlob(relativePath, pattern));
