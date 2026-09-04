export type SleepPhase = 'idle' | 'armed' | 'warning' | 'fading' | 'expired';

/** From here, a silent card offers to cancel or extend. */
export const WARNING_START_MS = 60_000;

/** From here, volume ramps to zero ahead of the pause. */
export const FADE_START_MS = 20_000;

/**
 * Pure function of two timestamps, no DOM, no timers. `useSleepTimer`
 * recomputes this from a fresh Date.now() on every check rather than
 * trusting elapsed time, which is what survives a backgrounded tab: a
 * frozen setTimeout can fire arbitrarily late, but this still answers
 * correctly no matter how far past the deadline `nowMs` lands.
 */
export function sleepPhase(nowMs: number, deadlineMs: number | null): SleepPhase {
  if (deadlineMs === null) return 'idle';
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) return 'expired';
  if (remaining <= FADE_START_MS) return 'fading';
  if (remaining <= WARNING_START_MS) return 'warning';
  return 'armed';
}
