import { redirect } from 'next/navigation';
import { ErrorPanel } from '@/components/ui/ErrorPanel';
import { ToastProvider } from '@/components/ui/Toast';
import API_BASE_URL from '@/lib/api';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import type { Episode, Movie, PlaybackAuthorization, SubscriptionPlan } from '@/types';
import { decodeMovies, decodePlans } from '@/types/api';
import PlayerClient from './PlayerClient';

function findEpisode(movies: Movie[], episodeId: string): { movie: Movie; episode: Episode } | null {
  for (const movie of movies) {
    for (const season of movie.seasons ?? []) {
      const episode = season.episodes.find((item) => item.id === episodeId);
      if (episode) return { movie, episode };
    }
  }
  return null;
}

async function getMovies(): Promise<Movie[]> {
  const response = await fetch(`${API_BASE_URL}/movies`, { next: { revalidate: 60 } });
  if (!response.ok) throw new Error('Failed to fetch movies');
  return decodeMovies(await response.json());
}

// GET /plans is not in ApiPath — subscribe/page.tsx already fetches it with
// a raw server-side fetch plus decodePlans, so this mirrors that rather
// than extending the API contract trio for one more Server Component.
async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/plans`, { next: { revalidate: 300 } });
    if (!response.ok) return [];
    return decodePlans(await response.json()).subscriptions;
  } catch {
    // The gate still works without them — it falls back to the /subscribe
    // link. A plans outage must never block playback.
    return [];
  }
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(withNext('/login', `/player/${id}`));

  const episodeId = id;
  let playback: { movie: Movie; episode: Episode } | null = null;
  let authorization: PlaybackAuthorization | null = null;
  let sessionExpired = false;
  // getSubscriptionPlans never throws (see above), so joining it here can't
  // turn a plans outage into the catch block's "can't load this episode"
  // failure path below.
  const plansPromise = getSubscriptionPlans();
  try {
    const [movies, authorizationResult] = await Promise.all([
      getMovies(),
      apiFetchServer(`/playback/${episodeId}/authorize`),
    ]);
    playback = findEpisode(movies, episodeId);
    authorization = authorizationResult;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) sessionExpired = true;
    console.error('Error loading player on server:', error);
  }
  const plans = await plansPromise;

  if (sessionExpired) redirect(withNext('/login', `/player/${id}`));
  if (!playback || !authorization) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink px-6">
        <ErrorPanel message="ไม่สามารถโหลดตอนนี้ได้" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <PlayerClient
        key={episodeId}
        episodeId={episodeId}
        initialMovie={playback.movie}
        initialEpisode={playback.episode}
        initialAuthorization={authorization}
        initialBalance={session.coinBalance}
        plans={plans}
      />
    </ToastProvider>
  );
}
