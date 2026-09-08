export const NIGHT_SUGGESTION_KEY = 'flicer.night.suggestedAt';

/** [22:00, 05:00) local time, inclusive of 22 and exclusive of 5. */
export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 5;
}

/**
 * Fails closed: if storage access throws, a dismissal can't be remembered
 * reliably either, so reporting "not yet suggested" would nag on every
 * page load in a restricted browser. Reporting "already suggested" is the
 * less annoying failure.
 */
export function hasBeenSuggested(): boolean {
  try {
    return window.localStorage.getItem(NIGHT_SUGGESTION_KEY) !== null;
  } catch {
    return true;
  }
}

export function markSuggested(): void {
  try {
    window.localStorage.setItem(NIGHT_SUGGESTION_KEY, new Date().toISOString());
  } catch {
    // Best-effort, same as prefs.ts and sleepStorage.ts.
  }
}
