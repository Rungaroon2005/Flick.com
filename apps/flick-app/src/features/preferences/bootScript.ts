import { PREFS_STORAGE_KEY } from './prefs';

/**
 * Runs as a blocking inline <script>, the first thing in <body>, before
 * hydration and before anything else paints. Doing this in a useEffect
 * instead would let one bright frame render first on every load — the
 * single most noticeable bug a "don't blind me at night" feature could
 * ship.
 *
 * Deliberately NOT a call into prefs.ts: this runs before any bundle is
 * parsed. It duplicates prefs.ts's decode logic in miniature (tolerate a
 * missing key, corrupt JSON, and a thrown storage access) rather than
 * importing it, but shares PREFS_STORAGE_KEY so the two cannot read from
 * different places.
 *
 * React never manages `data-night` as a JSX attribute — only this script
 * and PreferencesProvider's mirror effect touch it — so there is nothing
 * for hydration to diff and no mismatch warning.
 */
export const NIGHT_BOOT_SCRIPT = `
try {
  var raw = localStorage.getItem(${JSON.stringify(PREFS_STORAGE_KEY)});
  if (raw) {
    var prefs = JSON.parse(raw);
    if (prefs && prefs.night === true) {
      document.documentElement.setAttribute('data-night', 'on');
    }
  }
} catch (e) {}
`.trim();
