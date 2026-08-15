import { useCallback, useEffect, useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';
import type { Episode, Movie, PlaybackAuthorization } from '@/types';

export type DeniedAuthorization = Extract<PlaybackAuthorization, { allowed: false }>;

function findEpisode(movies: Movie[], episodeId: string) {
  for (const movie of movies) {
    for (const season of movie.seasons ?? []) {
      const episode = season.episodes.find((item) => item.id === episodeId);
      if (episode) return { movie, episode };
    }
  }
  return null;
}

/**
 * Owns "what are we watching and may this user watch it" — the single
 * server-side entitlement decision point (docs/FRONTEND_PLAN.md: the
 * PlaybackService rule) reflected client-side. Extracted unchanged from
 * PlayerClient (Phase 4 Step 1: no behavior change, verified against
 * test/entitlement.e2e-spec.ts before any markup in this route was touched).
 */
export function useEntitlement(episodeId: string, router: ReturnType<typeof useRouter>) {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [gate, setGate] = useState<DeniedAuthorization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // Public catalogue metadata deliberately remains a separate request from
  // entitlement. It never contains videoUrl, and a metadata fault cannot turn
  // into an authorization grant.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const movies = await apiFetch<Movie[]>('/movies');
        const result = findEpisode(movies, episodeId);
        if (cancelled) return;
        if (!result) {
          setError('ไม่พบตอนนี้');
          return;
        }
        setMovie(result.movie);
        setEpisode(result.episode);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError('ไม่สามารถโหลดข้อมูลตอนนี้ได้');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId, router]);

  const applyAuthorization = useCallback((auth: PlaybackAuthorization) => {
    if (auth.allowed) {
      setVideoUrl(auth.videoUrl);
      setGate(null);
      setGateError(null);
    } else {
      setVideoUrl(null);
      setGate(auth);
    }
  }, []);

  // The server is the only entitlement authority. The cancellation guard is
  // load-bearing: route changes must not let a late response mutate this page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const auth = await apiFetch<PlaybackAuthorization>(
          `/playback/${episodeId}/authorize`,
        );
        if (!cancelled) applyAuthorization(auth);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'ไม่สามารถตรวจสอบสิทธิ์การรับชมได้',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAuthorization, episodeId, router]);

  const unlockWithCoins = useCallback(async () => {
    setUnlocking(true);
    setGateError(null);
    try {
      await apiFetch('/wallet/spend', {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
      });
      // Never grant optimistically after a spend: ask the authority again.
      const auth = await apiFetch<PlaybackAuthorization>(
        `/playback/${episodeId}/authorize`,
      );
      applyAuthorization(auth);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      setGateError(
        err instanceof ApiError ? err.message : 'ไม่สามารถปลดล็อกตอนนี้ได้',
      );
    } finally {
      setUnlocking(false);
    }
  }, [applyAuthorization, episodeId, router]);

  return { movie, episode, videoUrl, gate, error, gateError, unlocking, unlockWithCoins };
}
