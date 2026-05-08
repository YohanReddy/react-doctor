import { Box, Text } from "ink";
import os from "node:os";
import path from "node:path";

interface HeaderProps {
  rootDirectory: string;
}

const formatProjectPath = (rootDirectory: string): string => {
  const homeDirectory = os.homedir();
  if (homeDirectory && rootDirectory.startsWith(homeDirectory)) {
    return path.join("~", rootDirectory.slice(homeDirectory.length));
  }
  return rootDirectory;
};

export const Header = ({ rootDirectory }: HeaderProps) => (
  <Box paddingX={1}>
    <Text color="gray">{formatProjectPath(rootDirectory)}</Text>
  </Box>
);
