import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import {
  DOCTOR_FACE_BLINK_HOLD_MS,
  DOCTOR_FACE_BLINK_INTERVAL_MS,
  DOCTOR_FACE_FRAME_INTERVAL_MS,
} from "../constants.js";
import type { DoctorMood } from "../types.js";
import { getBlinkFrame, getDoctorFrame } from "../utils/doctor-face-frames.js";

interface DoctorFaceProps {
  mood: DoctorMood;
  isAnimating: boolean;
}

const moodColor = (mood: DoctorMood): string => {
  switch (mood) {
    case "great":
      return "green";
    case "ok":
      return "yellow";
    case "bad":
    case "error":
      return "red";
    case "scanning":
      return "cyan";
    default:
      return "white";
  }
};

export const DoctorFace = ({ mood, isAnimating }: DoctorFaceProps) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    if (!isAnimating) return undefined;
    const animationInterval = setInterval(() => {
      setFrameIndex((previousFrameIndex) => previousFrameIndex + 1);
    }, DOCTOR_FACE_FRAME_INTERVAL_MS);
    return () => clearInterval(animationInterval);
  }, [isAnimating]);

  useEffect(() => {
    if (isAnimating) {
      setIsBlinking(false);
      return undefined;
    }
    let pendingBlinkRelease: ReturnType<typeof setTimeout> | null = null;
    const blinkScheduler = setInterval(() => {
      setIsBlinking(true);
      pendingBlinkRelease = setTimeout(() => setIsBlinking(false), DOCTOR_FACE_BLINK_HOLD_MS);
    }, DOCTOR_FACE_BLINK_INTERVAL_MS);
    return () => {
      clearInterval(blinkScheduler);
      if (pendingBlinkRelease) clearTimeout(pendingBlinkRelease);
    };
  }, [isAnimating]);

  const frame = isAnimating || !isBlinking ? getDoctorFrame(mood, frameIndex) : getBlinkFrame();
  const color = moodColor(mood);

  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Text color={color}>┌─────┐</Text>
      <Text color={color}>│{frame.eyes}│</Text>
      <Text color={color}>│{frame.mouth}│</Text>
      <Text color={color}>└─────┘</Text>
    </Box>
  );
};
