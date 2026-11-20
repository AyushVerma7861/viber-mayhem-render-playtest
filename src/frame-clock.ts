import { STEP } from './simulation.ts';

// A longer foreground interruption pauses the local match for an explicit resume.
// Ordinary slow frames retain every fixed tick, rather than stretching game time.
export const MAX_FRAME_GAP = 0.25;

export function planFrame(remainder: number, elapsed: number): {
  steps: number; remainder: number; interrupted: boolean;
} {
  if (!Number.isFinite(elapsed) || elapsed > MAX_FRAME_GAP + 1e-9) {
    return { steps: 0, remainder: 0, interrupted: true };
  }
  const total = remainder + Math.max(0, elapsed);
  const steps = Math.floor((total + 1e-9) / STEP);
  return { steps, remainder: Math.max(0, total - steps * STEP), interrupted: false };
}
