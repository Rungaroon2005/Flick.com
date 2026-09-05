'use client';
import { useEffect, useState } from 'react';
import { fetchWatchStatus } from './api';
import type { WatchStatusResponse } from '@/types';

/** Mirrors the API's own cap (EngagementService.getWatchStatus) -- a
 *  shelf never renders more posters than that at once anyway. */
const MAX_MOVIE_IDS = 50;

/**
 * Fetches /me/watch-status for a set of movie ids and returns the raw
 * lookup map, keyed by movie id -- never folded into the initial
 * server-rendered movie list, since that list comes from the shared
 * /movies cache and this is personal, per-user data (design doc §2.1).
 */
export function useWatchStatus(movieIds: string[]): WatchStatusResponse {
  const [status, setStatus] = useState<WatchStatusResponse>({});
  // Keyed on the joined ids, not the array itself -- callers pass a fresh
  // array on every render, and re-fetching on identity alone would refetch
  // every render for no reason.
  const key = movieIds.slice(0, MAX_MOVIE_IDS).join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchWatchStatus(key.split(','))
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // Best-effort: a failed watch-status fetch shouldn't block the
        // page render it decorates. Cards simply show no badge.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Guards against showing a stale fetch's results once the caller's id
  // set has emptied out (e.g. search results cleared) -- `status` itself
  // isn't reset on that transition, since doing so from inside the effect
  // above would be a synchronous setState call in an effect body.
  return key ? status : {};
}
