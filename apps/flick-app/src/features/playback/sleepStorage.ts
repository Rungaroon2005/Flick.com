export type SleepState = { mode: 'timer'; deadlineMs: number } | { mode: 'end-of-episode' };

export const SLEEP_STORAGE_KEY = 'flicer.sleep';

/**
 * Unlike prefs.ts's field-by-field tolerance, a malformed sleep entry is
 * discarded WHOLE: a timer with a corrupt deadline or an unrecognized mode
 * has no safe partial reading, so treating it as "no sleep timer set" is
 * the only sound fallback.
 */
function decodeSleepState(value: unknown): SleepState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.mode === 'end-of-episode') return { mode: 'end-of-episode' };
  if (record.mode === 'timer' && typeof record.deadlineMs === 'number') {
    return { mode: 'timer', deadlineMs: record.deadlineMs };
  }
  return null;
}

export function loadSleepState(): SleepState | null {
  try {
    const raw = window.localStorage.getItem(SLEEP_STORAGE_KEY);
    if (!raw) return null;
    return decodeSleepState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveSleepState(state: SleepState | null): void {
  try {
    if (state === null) {
      window.localStorage.removeItem(SLEEP_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SLEEP_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Best-effort, same as prefs.ts -- a lost sleep-timer preference across
    // a reload is a minor inconvenience, not a correctness issue.
  }
}
