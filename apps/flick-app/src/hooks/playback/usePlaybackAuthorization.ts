import { useCallback, useEffect, useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';
import type { PlaybackAuthorization } from '@/types';

export type DeniedAuthorization = Extract<PlaybackAuthorization, { allowed: false }>;

export function usePlaybackAuthorization(
  episodeId: string,
  router: ReturnType<typeof useRouter>,
  enabled = true,
) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [gate, setGate] = useState<DeniedAuthorization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const applyAuthorization = useCallback((authorization: PlaybackAuthorization) => {
    if (authorization.allowed) {
      setVideoUrl(authorization.videoUrl);
      setGate(null);
      setGateError(null);
      return;
    }

    setVideoUrl(null);
    setGate(authorization);
  }, []);

  const authorize = useCallback(async () => {
    try {
      const authorization = await apiFetch<PlaybackAuthorization>(`/playback/${episodeId}/authorize`);
      applyAuthorization(authorization);
      return authorization;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return null;
      }
      setError(err instanceof ApiError ? err.message : 'ไม่สามารถตรวจสอบสิทธิ์การรับชมได้');
      return null;
    }
  }, [applyAuthorization, episodeId, router]);

  useEffect(() => {
    if (!enabled || videoUrl || gate) return;
    let cancelled = false;

    void apiFetch<PlaybackAuthorization>(`/playback/${episodeId}/authorize`)
      .then((authorization) => {
        if (!cancelled) applyAuthorization(authorization);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'ไม่สามารถตรวจสอบสิทธิ์การรับชมได้');
      });

    return () => {
      cancelled = true;
    };
  }, [applyAuthorization, enabled, episodeId, gate, router, videoUrl]);

  const unlockWithCoins = useCallback(async () => {
    setUnlocking(true);
    setGateError(null);
    try {
      await apiFetch('/wallet/spend', {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
      });
      await authorize();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setGateError(err instanceof ApiError ? err.message : 'ไม่สามารถปลดล็อกตอนนี้ได้');
    } finally {
      setUnlocking(false);
    }
  }, [authorize, episodeId, router]);

  return { videoUrl, gate, error, gateError, unlocking, authorize, unlockWithCoins };
}
