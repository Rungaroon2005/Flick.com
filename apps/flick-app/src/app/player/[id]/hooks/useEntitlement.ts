import { useEffect, useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/apiClient';
import { usePlaybackAuthorization } from '@/hooks/playback/usePlaybackAuthorization';
import type { Episode, Movie, PlaybackAuthorization } from '@/types';

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
export function useEntitlement(
  episodeId: string,
  router: ReturnType<typeof useRouter>,
  initialMovie?: Movie,
  initialEpisode?: Episode,
  initialAuthorization?: PlaybackAuthorization,
) {
  const [movie, setMovie] = useState<Movie | null>(initialMovie ?? null);
  const [episode, setEpisode] = useState<Episode | null>(initialEpisode ?? null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const authorization = usePlaybackAuthorization(episodeId, router, true, initialAuthorization);

  // Public catalogue metadata deliberately remains a separate request from
  // entitlement. It never contains videoUrl, and a metadata fault cannot turn
  // into an authorization grant.
  useEffect(() => {
    if (movie && episode) return;
    let cancelled = false;
    void (async () => {
      try {
        const movies = await apiFetch<Movie[]>('/movies');
        const result = findEpisode(movies, episodeId);
        if (cancelled) return;
        if (!result) {
          setMetadataError('ไม่พบตอนนี้');
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
        setMetadataError('ไม่สามารถโหลดข้อมูลตอนนี้ได้');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episode, episodeId, movie, router]);

  return { movie, episode, ...authorization, error: metadataError ?? authorization.error };
}
