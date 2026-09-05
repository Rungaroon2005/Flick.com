import { Injectable } from '@nestjs/common';
import { MoviesService } from '../movies/movies.service';
import { EngagementService } from '../engagement/engagement.service';

interface SceneMarkerLike {
  startSeconds: number;
  endSeconds: number;
}

export type FitsKind = 'film' | 'next_episode' | 'first_episode';

export interface FitsItem {
  movie: unknown;
  episode: unknown;
  kind: FitsKind;
  runtimeMinutes: number;
  finishesAtHint: string;
}

function skippableSeconds(markers: SceneMarkerLike[]): number {
  return markers.reduce(
    (total, m) => total + (m.endSeconds - m.startSeconds),
    0,
  );
}

function toItem(
  movie: unknown,
  episode: { durationMinutes: number; sceneMarkers: SceneMarkerLike[] },
  kind: FitsKind,
  alreadyElapsedSeconds: number,
): FitsItem {
  const remainingSeconds = Math.max(
    0,
    episode.durationMinutes * 60 -
      alreadyElapsedSeconds -
      skippableSeconds(episode.sceneMarkers),
  );
  return {
    movie,
    episode,
    kind,
    runtimeMinutes: Math.ceil(remainingSeconds / 60),
    finishesAtHint: new Date(
      Date.now() + remainingSeconds * 1000,
    ).toISOString(),
  };
}

/**
 * Composes two ALREADY-TESTED services rather than issuing its own Prisma
 * queries: MoviesService.findAll() is the same 5-minute cached content list
 * every browsing view reads, and EngagementService.getContinueWatching()
 * is the same in-progress list the home page's shelf reads. Neither needed
 * a new query to serve this feature -- only new arithmetic over what they
 * already return.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly movies: MoviesService,
    private readonly engagement: EngagementService,
  ) {}

  async fits(userId: string, maxMinutes: number): Promise<FitsItem[]> {
    const [allMovies, continueWatching] = await Promise.all([
      this.movies.findAll(),
      this.engagement.getContinueWatching(userId),
    ]);

    const items: FitsItem[] = [];
    const coveredMovieIds = new Set<string>();

    for (const record of continueWatching as unknown as {
      progressSeconds: number;
      episode: { durationMinutes: number; sceneMarkers: SceneMarkerLike[] };
      movie: { id: string };
    }[]) {
      coveredMovieIds.add(record.movie.id);
      const item = toItem(
        record.movie,
        record.episode,
        'next_episode',
        record.progressSeconds,
      );
      if (item.runtimeMinutes <= maxMinutes) items.push(item);
    }

    for (const movie of allMovies) {
      if (coveredMovieIds.has(movie.id)) continue;
      const allEpisodes = movie.seasons.flatMap(
        (season) => season.episodes,
      ) as {
        durationMinutes: number;
        sceneMarkers: SceneMarkerLike[];
      }[];
      if (allEpisodes.length === 0) continue;

      const [first] = allEpisodes;
      const kind: FitsKind =
        allEpisodes.length === 1 ? 'film' : 'first_episode';
      const item = toItem(movie, first, kind, 0);
      if (item.runtimeMinutes <= maxMinutes) items.push(item);
    }

    return items;
  }
}
