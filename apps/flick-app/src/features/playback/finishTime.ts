export interface EstimateFinishTimeInput {
  now: Date;
  /** Content seconds left to watch, not the episode's total duration. */
  remainingSeconds: number;
  /** Sum of every scene marker's duration for this episode. */
  skippableSeconds: number;
  /** Whether markers are ACTUALLY being skipped -- if false, the user
   *  will watch through them for real, so nothing is subtracted. */
  autoSkip: boolean;
  playbackRate: number;
}

export interface EstimatedFinishTime {
  finishesAt: Date;
  /** Wall-clock seconds saved by auto-skip, for the "ข้าม intro/credits
   *  แล้วเร็วขึ้น X นาที" hint. Zero whenever autoSkip is off. */
  savedSeconds: number;
}

/**
 * Pure function of its inputs, no DOM, no timers -- recomputed fresh every
 * time the caller wants the number (e.g. on each player-overlay open), not
 * memoized against a play-time snapshot, or a ten-minute pause would leave
 * a confidently wrong ETA on screen.
 */
export function estimateFinishTime(input: EstimateFinishTimeInput): EstimatedFinishTime {
  const effectiveSkippable = input.autoSkip
    ? Math.min(input.skippableSeconds, input.remainingSeconds)
    : 0;
  const watchSeconds = Math.max(0, input.remainingSeconds - effectiveSkippable);
  const wallClockMs = (watchSeconds / input.playbackRate) * 1000;

  return {
    finishesAt: new Date(input.now.getTime() + wallClockMs),
    savedSeconds: effectiveSkippable / input.playbackRate,
  };
}

export function formatDurationThai(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  if (minutes === 0) return `${hours} ชม`;
  return `${hours} ชม ${minutes} นาที`;
}

/** Hand-rolled rather than Intl.DateTimeFormat/toLocaleTimeString: this
 *  matches the existing formatTime() in PlayerClient's own convention of
 *  not depending on ICU locale data being present, and 24-hour
 *  zero-padded local time is all "จบ 22:07" needs. */
export function formatClockTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
