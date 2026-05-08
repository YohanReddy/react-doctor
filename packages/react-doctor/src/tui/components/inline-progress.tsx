import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { StepState } from "../types.js";

interface InlineProgressProps {
  steps: StepState[];
}

const RUNNING_STEP_PRIORITY: Record<StepState["status"], number> = {
  running: 0,
  pending: 1,
  fail: 2,
  skip: 3,
  succeed: 4,
};

const pickActiveStep = (steps: StepState[]): StepState | null => {
  if (steps.length === 0) return null;
  const sorted = steps.toSorted(
    (firstStep, secondStep) =>
      RUNNING_STEP_PRIORITY[firstStep.status] - RUNNING_STEP_PRIORITY[secondStep.status],
  );
  const firstSorted = sorted[0];
  if (firstSorted.status === "succeed") return null;
  return firstSorted;
};

export const InlineProgress = ({ steps }: InlineProgressProps) => {
  const completedStepCount = steps.filter((step) => step.status === "succeed").length;
  const totalRelevantSteps = steps.filter((step) => step.status !== "skip").length;
  const activeStep = pickActiveStep(steps);
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text color="white"> {activeStep ? activeStep.message : "Working…"}</Text>
      {totalRelevantSteps > 0 ? (
        <Text color="gray">
          {" "}
          ({completedStepCount}/{totalRelevantSteps})
        </Text>
      ) : null}
    </Box>
  );
};
