import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';

/**
 * Owns reporting playback position to PUT /me/watch-history/:episodeId —
 * throttled to once per 10 real seconds of progress, flushed once more on
 * unmount. Extracted unchanged from PlayerClient (Phase 4 Step 1 — see
 * useEntitlement.ts for the same note).
 */
export function useWatchProgress(
  episodeId: string,
  router: ReturnType<typeof useRouter>,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  const [progressSeconds, setProgressSeconds] = useState(0);
  const progressRef = useRef(0);
  const lastReportedRef = useRef(0);

  const reportProgress = useCallback(
    async (seconds: number) => {
      if (seconds <= 0 || seconds === lastReportedRef.current) return;
      // Reserve this checkpoint before awaiting the network so several
      // timeupdate events in the same second cannot enqueue duplicate writes.
      lastReportedRef.current = seconds;
      try {
        await apiFetch(`/me/watch-history/${episodeId}`, {
          method: 'PUT',
          keepalive: true,
          body: JSON.stringify({ progressSeconds: seconds }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
      }
    },
    [episodeId, router],
  );

  useEffect(
    () => () => {
      void reportProgress(progressRef.current);
    },
    [reportProgress],
  );

  const setProgress = (seconds: number) => {
    progressRef.current = seconds;
    setProgressSeconds(seconds);
  };

  const handleTimeUpdate = () => {
    const seconds = Math.max(0, Math.floor(videoRef.current?.currentTime ?? 0));
    setProgress(seconds);
    if (seconds > 0 && Math.abs(seconds - lastReportedRef.current) >= 10) {
      void reportProgress(seconds);
    }
  };

  return { progressSeconds, setProgress, handleTimeUpdate, reportProgress };
}
