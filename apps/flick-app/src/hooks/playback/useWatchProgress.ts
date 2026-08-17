import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';

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
