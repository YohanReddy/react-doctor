import { Box, Text } from "ink";
import path from "node:path";
import type { ProjectInfo } from "../../types.js";
import { APP_SUBTITLE, APP_TITLE, VERY_NARROW_LAYOUT_BREAKPOINT_COLS } from "../constants.js";

interface HeaderProps {
  rootDirectory: string;
  project: ProjectInfo | null;
  isWatching: boolean;
  terminalColumns: number;
}

const formatFrameworkLabel = (framework: ProjectInfo["framework"]): string => {
  const labels: Record<ProjectInfo["framework"], string> = {
    nextjs: "Next.js",
    "tanstack-start": "TanStack Start",
    vite: "Vite",
    cra: "Create React App",
    remix: "Remix",
    gatsby: "Gatsby",
    expo: "Expo",
    "react-native": "React Native",
    unknown: "React",
  };
  return labels[framework];
};

export const Header = ({ rootDirectory, project, isWatching, terminalColumns }: HeaderProps) => {
  const projectName = project?.projectName ?? path.basename(rootDirectory);
  const isCompact = terminalColumns < VERY_NARROW_LAYOUT_BREAKPOINT_COLS;
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text color="magenta" bold>
          {APP_TITLE}
        </Text>
        {!isCompact ? <Text color="gray"> {APP_SUBTITLE}</Text> : null}
      </Box>
      <Box>
        <Text color="white" bold>
          {projectName}
        </Text>
        {project && !isCompact ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="cyan">{formatFrameworkLabel(project.framework)}</Text>
            <Text color="gray"> · </Text>
            <Text color="cyan">React {project.reactVersion ?? "?"}</Text>
            <Text color="gray"> · </Text>
            <Text color="cyan">{project.hasTypeScript ? "TS" : "JS"}</Text>
          </>
        ) : null}
        {isWatching ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="green">● watching</Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
};
