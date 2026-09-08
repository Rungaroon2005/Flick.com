'use client';
import { apiFetch } from '@/lib/apiClient';
import type { Movie, WatchStatusEntry, WatchStatusResponse } from '@/types';

/** Caps mirror the API's own 50-id limit (EngagementService.getWatchStatus). */
export async function fetchWatchStatus(movieIds: string[]): Promise<WatchStatusResponse> {
  return apiFetch(`/me/watch-status?movieIds=${movieIds.join(',')}`);
}

export interface MovieWithWatchStatus extends Movie {
  watchStatus: WatchStatusEntry;
}

const DEFAULT_STATUS: WatchStatusEntry = {
  state: 'none',
  percent: 0,
  lastWatchedAt: null,
};

/**
 * Client-side merge, deliberately: /movies is one cache slot shared by
 * every caller regardless of auth state, and folding personal watch
 * status into that response server-side would be exactly the leak the
 * cache invariant (design doc §2.1) exists to prevent -- one user's
 * history rendered on another user's screen. This merge happens entirely
 * in the browser, after both responses have already arrived separately.
 */
export function mergeWatchStatus(
  movies: Movie[],
  status: WatchStatusResponse,
): MovieWithWatchStatus[] {
  return movies.map((movie) => ({
    ...movie,
    watchStatus: status[movie.id] ?? DEFAULT_STATUS,
  }));
}
