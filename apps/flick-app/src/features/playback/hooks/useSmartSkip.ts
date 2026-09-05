import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface SceneMarkerLike {
  kind: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * End-exclusive: a marker covers [startSeconds, endSeconds). Landing
 * exactly on endSeconds (which is where skip() jumps to) must read as
 * "no longer inside it," or a skip immediately re-triggers itself.
 */
export function findActiveMarker<T extends SceneMarkerLike>(
  markers: T[],
  currentTimeSeconds: number,
): T | null {
  return (
    markers.find(
      (m) => currentTimeSeconds >= m.startSeconds && currentTimeSeconds < m.endSeconds,
    ) ?? null
  );
}

export interface UseSmartSkipResult<T extends SceneMarkerLike> {
  activeMarker: T | null;
  /** Jumps past the currently active marker. No-op if none is active. */
  skip: () => void;
}

/**
 * `currentTimeSeconds` is a plain number input, not read from the video
 * element itself -- the caller (PlayerClient) already tracks this via
 * useWatchProgress's progressSeconds, updated on every native timeupdate
 * tick, so this hook stays a pure function of that value plus the marker
 * list rather than attaching its own listener.
 */
export function useSmartSkip<T extends SceneMarkerLike>(
  videoRef: RefObject<HTMLVideoElement | null>,
  markers: T[],
  currentTimeSeconds: number,
  autoSkip: boolean,
): UseSmartSkipResult<T> {
  const activeMarker = findActiveMarker(markers, currentTimeSeconds);

  // Keyed by `kind`, not object identity: dedupes "already jumped this
  // marker" without depending on the caller memoizing the markers array.
  // Cleared once currentTimeSeconds leaves the marker window, so a LATER
  // marker (e.g. CREDITS after INTRO) still auto-skips.
  const autoSkippedKindRef = useRef<string | null>(null);

  const skip = useCallback(() => {
    if (!activeMarker) return;
    const video = videoRef.current;
    if (video) video.currentTime = activeMarker.endSeconds;
  }, [activeMarker, videoRef]);

  useEffect(() => {
    if (!autoSkip || !activeMarker) {
      autoSkippedKindRef.current = null;
      return;
    }
    if (autoSkippedKindRef.current === activeMarker.kind) return;
    autoSkippedKindRef.current = activeMarker.kind;
    const video = videoRef.current;
    if (video) video.currentTime = activeMarker.endSeconds;
  }, [activeMarker, autoSkip, videoRef]);

  return { activeMarker, skip };
}
