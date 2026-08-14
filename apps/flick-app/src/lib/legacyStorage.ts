'use client';

// Keys written by the pre-Phase-3 localStorage "auth" layer. The server is now
// authoritative for every one of these, so the stale client-authored copies are
// purged on login/register rather than migrated — they were never real data.
const LEGACY_KEYS = [
  'flick_auth',
  'flick_subscription',
  'flick_coins',
  'flick_watch_history',
  'flick_bookmarks',
  'flick_downloads',
] as const;

export function clearLegacyLocalState(): void {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_KEYS) {
    window.localStorage.removeItem(key);
  }
}
