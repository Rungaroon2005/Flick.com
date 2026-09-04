export interface Prefs {
  night: boolean;
  autoplayNext: boolean;
  autoSkip: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  night: false,
  autoplayNext: true,
  autoSkip: false,
};

export const PREFS_STORAGE_KEY = 'flicer.prefs';

/**
 * Field-by-field, not "any invalid field discards the whole object": a
 * future field added to Prefs must not make every existing user's
 * already-stored preferences look corrupt, and one bad field (e.g. from a
 * manual edit) should not cost the other valid ones.
 */
function decodePrefs(value: unknown): Prefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_PREFS;
  }
  const record = value as Record<string, unknown>;
  return {
    night: typeof record.night === 'boolean' ? record.night : DEFAULT_PREFS.night,
    autoplayNext:
      typeof record.autoplayNext === 'boolean'
        ? record.autoplayNext
        : DEFAULT_PREFS.autoplayNext,
    autoSkip:
      typeof record.autoSkip === 'boolean' ? record.autoSkip : DEFAULT_PREFS.autoSkip,
  };
}

/**
 * Private browsing and storage-blocked contexts can throw on ACCESS, not
 * just return null — an unguarded read here would crash the player for
 * those users over a cosmetic preference.
 */
export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return decodePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort. A user who can't persist a preference still gets to use
    // the app with today's default for it.
  }
}
