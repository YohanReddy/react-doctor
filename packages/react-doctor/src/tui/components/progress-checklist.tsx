import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { StepState } from "../types.js";

interface ProgressChecklistProps {
  steps: StepState[];
  compact?: boolean;
}

const renderStatusIcon = (step: StepState): React.ReactElement => {
  switch (step.status) {
    case "running":
      return (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      );
    case "succeed":
      return <Text color="green">✓</Text>;
    case "fail":
      return <Text color="red">✗</Text>;
    case "skip":
      return <Text color="gray">·</Text>;
    case "pending":
    default:
      return <Text color="gray">○</Text>;
  }
};

const messageColor = (status: StepState["status"]): string | undefined => {
  if (status === "running") return "white";
  if (status === "succeed") return "white";
  if (status === "fail") return "red";
  if (status === "skip") return "gray";
  return "gray";
};

export const ProgressChecklist = ({ steps, compact }: ProgressChecklistProps) => {
  const visibleSteps = compact
    ? steps.filter((step) => step.status !== "pending" && step.status !== "skip")
    : steps;
  return (
    <Box flexDirection="column">
      {visibleSteps.map((step) => (
        <Box key={step.id}>
          {renderStatusIcon(step)}
          <Text> </Text>
          <Text color={messageColor(step.status)}>{step.message}</Text>
          {step.detail ? <Text color="gray"> — {step.detail}</Text> : null}
        </Box>
      ))}
    </Box>
  );
};
