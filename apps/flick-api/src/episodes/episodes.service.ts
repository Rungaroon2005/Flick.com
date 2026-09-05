import { Injectable, NotFoundException } from '@nestjs/common';
import { Genre, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AVAILABLE_EPISODE_FILTER } from '../common/content-availability';

/**
 * The parent movie is fetched through the episode's own season rather than
 * as a second query: one indexed lookup replaces the `GET /movies` +
 * client-side `findEpisode()` walk the player used to do, whose cost scaled
 * with the size of the whole catalogue.
 *
 * `seasons` is deliberately NOT included. The player's only use for it was
 * the very walk this endpoint removes, so shipping every episode of every
 * season back would re-create the payload problem in a new place.
 */
const EPISODE_WITH_MOVIE_INCLUDE = {
  sceneMarkers: true,
  season: {
    include: {
      movie: { include: { genres: { include: { genre: true } } } },
    },
  },
} satisfies Prisma.EpisodeInclude;

type EpisodeWithMovie = Prisma.EpisodeGetPayload<{
  include: typeof EPISODE_WITH_MOVIE_INCLUDE;
}>;

type MovieOf = EpisodeWithMovie['season']['movie'];

export interface EpisodeDetail {
  episode: Omit<EpisodeWithMovie, 'videoUrl' | 'season'>;
  movie: Omit<MovieOf, 'genres'> & { genres: Genre[] };
}

@Injectable()
export class EpisodesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One episode plus the movie it belongs to, for the player route.
   *
   * `videoUrl` is stripped here for the same reason `MoviesService.toDto`
   * strips it: it is the one piece of data that actually lets someone watch
   * a video, and it must be reachable ONLY through
   * `GET /playback/:episodeId/authorize`. The key is deleted outright rather
   * than nulled, so its mere presence in the JSON cannot leak information
   * once real videoUrls exist.
   *
   * Availability is enforced by the shared `AVAILABLE_EPISODE_FILTER`, so a
   * draft or soft-deleted movie's episodes 404 here exactly as they do on
   * the playback and movie endpoints — this endpoint cannot become a side
   * door around content status.
   */
  async findOne(episodeId: string): Promise<EpisodeDetail> {
    const found = await this.prisma.episode.findFirst({
      where: { id: episodeId, ...AVAILABLE_EPISODE_FILTER },
      include: EPISODE_WITH_MOVIE_INCLUDE,
    });

    if (!found) throw new NotFoundException('ไม่พบตอนนี้');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { videoUrl: _videoUrl, season, ...episode } = found;
    const { genres, ...movie } = season.movie;

    return {
      episode,
      movie: { ...movie, genres: genres.map((g) => g.genre) },
    };
  }
}
