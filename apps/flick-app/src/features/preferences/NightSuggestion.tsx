'use client';

import { useEffect, useState } from 'react';
import { usePreferences } from './PreferencesProvider';
import { loadPrefs } from './prefs';
import { hasBeenSuggested, isNightHour, markSuggested } from './nightSuggestionStorage';

/**
 * Offered once, ever, per the design: dismissal is permanent, and so is
 * accepting. The write happens the instant the offer is DECIDED, not on
 * whatever the user answers -- closing the tab without touching it must
 * still count as "already asked."
 */
export function NightSuggestion() {
  const { setNight } = usePreferences();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Deferred to a microtask for the same reason as PreferencesProvider's
    // own load effect: a synchronous setState here would cascade a render.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      // Reads storage directly rather than usePreferences().prefs.night:
      // that value starts at DEFAULT_PREFS and only becomes the real
      // stored preference after PreferencesProvider's OWN deferred load
      // effect settles. This effect's closure captured prefs from ITS
      // first render and never re-runs (deliberately one-shot), so
      // reading through the context here would check a value that is
      // ALWAYS the pre-load default, regardless of what's actually
      // stored -- a night: true user would still get offered the
      // suggestion, since the "already on" check could never see it.
      // loadPrefs() is a synchronous read with no such race.
      if (loadPrefs().night) return;
      if (hasBeenSuggested()) return;
      if (!isNightHour(new Date().getHours())) return;
      markSuggested();
      setVisible(true);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: this is a one-time check of the moment the
    // app opened, not a live rule that reappears the instant prefs.night
    // later flips back to false.
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="ข้อเสนอโหมดกลางคืน"
      className="fixed inset-x-4 bottom-24 z-[200] rounded-2xl border border-white/10 bg-ink-1/95 p-4 text-fg shadow-surface backdrop-blur-xl"
    >
      <p className="text-sm">ตอนนี้ดึกแล้ว เปิดโหมดกลางคืนเพื่อลดแสงจ้าไหม?</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="focus-ring rounded-full px-4 py-2 text-sm font-medium text-fg-dim transition-colors hover:text-fg"
        >
          ไม่เป็นไร
        </button>
        <button
          type="button"
          onClick={() => {
            setNight(true);
            setVisible(false);
          }}
          className="focus-ring rounded-full bg-brand px-4 py-2 text-sm font-medium text-ink"
        >
          เปิดโหมดกลางคืน
        </button>
      </div>
    </div>
  );
}
