import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Genre, InteractionType, Mood, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlaybackService } from '../playback/playback.service';
import { GENRES_INCLUDE, MOODS_INCLUDE } from '../movies/movies.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const COMPLETION_THRESHOLD = 0.9;
const CONTINUE_WATCHING_LIMIT = 10;
const WATCH_STATUS_MAX_MOVIE_IDS = 50;

export type WatchStatusState = 'none' | 'partial' | 'watched';

export interface WatchStatusEntry {
  state: WatchStatusState;
  percent: number;
  lastWatchedAt: string | null;
}

const DOWNLOAD_INCLUDE = {
  episode: {
    include: {
      season: {
        include: {
          movie: { include: { genres: GENRES_INCLUDE, moods: MOODS_INCLUDE } },
        },
      },
    },
  },
} satisfies Prisma.DownloadInclude;

type DownloadWithRelations = Prisma.DownloadGetPayload<{
  include: typeof DOWNLOAD_INCLUDE;
}>;

// Flattens the MovieGenre join-table shape (`{ genres: [{ genre: {...} }] }`)
// into the wire shape the frontend expects (`{ genres: Genre[] }`) — the
// same transform `MoviesService.toDto` applies to every other movie-bearing
// endpoint. Bookmarks and continue-watching return movies too, so they need
// it as well or `movie.genres` is `undefined` on the wire.
function flattenMovieGenres<
  T extends { genres: { genre: Genre }[]; moods?: { mood: Mood }[] },
>(movie: T) {
  const { genres, moods, ...rest } = movie;
  return {
    ...rest,
    genres: genres.map((g) => g.genre),
    moods: (moods ?? []).map((m) => m.mood),
  };
}

/**
 * Bookmarks, watch history, and downloads for the current user. Everything
 * here is scoped to `userId` taken from the authenticated request — never
 * from a client-supplied id — so one user can never read or mutate
 * another's engagement data.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: PlaybackService,
  ) {}

  // --- Bookmarks -------------------------------------------------------

  async addBookmark(userId: string, movieId: string) {
    // Idempotent: upserting on the (userId, movieId) unique key means a
    // double-tap just no-ops the second time instead of throwing a unique
    // constraint violation.
    await this.prisma.bookmark.upsert({
      where: { userId_movieId: { userId, movieId } },
      create: { userId, movieId },
      update: {},
    });
    return { bookmarked: true };
  }

  async removeBookmark(userId: string, movieId: string) {
    // deleteMany (not delete) so removing an absent bookmark is a
    // successful no-op rather than a P2025 "record not found" throw.
    await this.prisma.bookmark.deleteMany({ where: { userId, movieId } });
    return { bookmarked: false };
  }

  async getBookmarks(userId: string) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { userId },
      include: {
        movie: { include: { genres: GENRES_INCLUDE, moods: MOODS_INCLUDE } },
      },
    });
    return bookmarks.map((bookmark) => flattenMovieGenres(bookmark.movie));
  }

  // --- Movie actions ----------------------------------------------------

  async getMovieActions(userId: string, movieId: string) {
    const [bookmark, interaction] = await Promise.all([
      this.prisma.bookmark.findUnique({
        where: { userId_movieId: { userId, movieId } },
        select: { id: true },
      }),
      this.prisma.interaction.findUnique({
        where: { userId_movieId: { userId, movieId } },
        select: { type: true },
      }),
    ]);

    return {
      bookmarked: bookmark !== null,
      liked: interaction?.type === InteractionType.LIKE,
    };
  }

  async likeMovie(userId: string, movieId: string) {
    await this.prisma.interaction.upsert({
      where: { userId_movieId: { userId, movieId } },
      create: { userId, movieId, type: InteractionType.LIKE },
      update: { type: InteractionType.LIKE },
    });
    return { liked: true };
  }

  async unlikeMovie(userId: string, movieId: string) {
    await this.prisma.interaction.deleteMany({
      where: { userId, movieId, type: InteractionType.LIKE },
    });
    return { liked: false };
  }

  // --- Watch history / continue watching --------------------------------

  async updateProgress(
    userId: string,
    episodeId: string,
    progressSeconds: number,
  ) {
    // `completed` is ALWAYS derived from the episode's own duration, never
    // trusted from the client — otherwise a client could mark an episode
    // "watched" without actually watching it.
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { durationMinutes: true },
    });
    const completed =
      progressSeconds >= episode.durationMinutes * 60 * COMPLETION_THRESHOLD;
    return this.prisma.watchHistory.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, progressSeconds, completed },
      update: { progressSeconds, completed },
    });
  }

  async getContinueWatching(userId: string) {
    const records = await this.prisma.watchHistory.findMany({
      where: { userId, completed: false },
      orderBy: { updatedAt: 'desc' },
      take: CONTINUE_WATCHING_LIMIT,
      include: {
        episode: {
          include: {
            sceneMarkers: true,
            season: {
              include: {
                movie: {
                  include: { genres: GENRES_INCLUDE, moods: MOODS_INCLUDE },
                },
              },
            },
          },
        },
      },
    });
    return records.map((record) => this.toContinueWatchingDto(record));
  }

  // `videoUrl` must never be reachable through this list — the only
  // server-side path that returns a real videoUrl is
  // `PlaybackService.authorize` (see movies.service.ts `toDto` for the
  // same rule applied to the movie list). We also hoist `movie` out of the
  // nested `episode.season.movie` join so the wire shape matches
  // `{ movie, episode, progressSeconds }` per the API contract, and flatten
  // `movie.genres` the same way `MoviesService.toDto` does.
  private toContinueWatchingDto(record: {
    episode: {
      season: { movie: { genres: { genre: Genre }[]; [key: string]: unknown } };
      videoUrl: string | null;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }) {
    const { episode, ...rest } = record;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { season, videoUrl: _videoUrl, ...episodeRest } = episode;
    return {
      ...rest,
      episode: episodeRest,
      movie: flattenMovieGenres(season.movie),
    };
  }

  // --- Downloads ---------------------------------------------------------

  async addDownload(userId: string, episodeId: string) {
    // Entitlement-checked via the same authorization path playback uses —
    // otherwise downloads become a side door around subscription gating.
    const authorization = await this.playback.authorize(userId, episodeId);
    if (!authorization.allowed) {
      throw new ForbiddenException(
        'You are not authorized to download this episode',
      );
    }
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
    // Idempotent upsert; a repeat download-tap REFRESHES expiresAt rather
    // than silently keeping the original 30-day window.
    return this.prisma.download.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, expiresAt },
      update: { expiresAt },
    });
  }

  async removeDownload(userId: string, episodeId: string) {
    await this.prisma.download.deleteMany({ where: { userId, episodeId } });
    return { downloaded: false };
  }

  async getDownloads(userId: string) {
    const downloads = await this.prisma.download.findMany({
      where: { userId },
      orderBy: { downloadedAt: 'desc' },
      include: DOWNLOAD_INCLUDE,
    });
    return downloads.map((download) => this.toDownloadDto(download));
  }

  // Download records carry enough real metadata for the UI to render the
  // episode, while preserving PlaybackService as the only videoUrl owner.
  private toDownloadDto(download: DownloadWithRelations) {
    const { episode, ...rest } = download;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { season, videoUrl: _videoUrl, ...episodeRest } = episode;
    return {
      ...rest,
      episode: episodeRest,
      movie: flattenMovieGenres(season.movie),
    };
  }

  /**
   * Deliberately not folded into /movies: this differs per caller, and
   * /movies is one cache slot shared by every caller regardless of auth
   * state (see the design doc's cache invariant). movieIds is capped
   * BEFORE the query runs -- an unbounded `IN (...)` built from a query
   * string is a trivially abusable scan.
   */
  async getWatchStatus(
    userId: string,
    movieIds: string[],
  ): Promise<Record<string, WatchStatusEntry>> {
    if (movieIds.length > WATCH_STATUS_MAX_MOVIE_IDS) {
      throw new BadRequestException(
        `At most ${WATCH_STATUS_MAX_MOVIE_IDS} movieIds are allowed per request`,
      );
    }

    const movies = await this.prisma.movie.findMany({
      where: { id: { in: movieIds } },
      include: {
        seasons: {
          include: {
            // Excludes a takedown episode from the denominator: nobody can
            // watch it anymore, so it must not silently cap what "100%"
            // means for this movie.
            episodes: {
              where: { deletedAt: null },
              select: { id: true, durationMinutes: true },
            },
          },
        },
      },
    });

    const episodesByMovie = new Map<
      string,
      { id: string; durationMinutes: number }[]
    >();
    for (const movie of movies) {
      episodesByMovie.set(
        movie.id,
        movie.seasons.flatMap((season) => season.episodes),
      );
    }

    const allEpisodeIds = [...episodesByMovie.values()].flatMap((episodes) =>
      episodes.map((e) => e.id),
    );
    const histories = await this.prisma.watchHistory.findMany({
      where: { userId, episodeId: { in: allEpisodeIds } },
    });
    const historyByEpisode = new Map(histories.map((h) => [h.episodeId, h]));

    const result: Record<string, WatchStatusEntry> = {};
    for (const movieId of movieIds) {
      const episodes = episodesByMovie.get(movieId) ?? [];
      const totalSeconds = episodes.reduce(
        (sum, e) => sum + e.durationMinutes * 60,
        0,
      );

      let watchedSeconds = 0;
      let lastWatchedAt: Date | null = null;
      for (const episode of episodes) {
        const history = historyByEpisode.get(episode.id);
        if (!history) continue;
        const durationSeconds = episode.durationMinutes * 60;
        // `completed` pins the contribution to the full duration
        // regardless of progressSeconds: the 90% completion threshold
        // (see updateProgress) can mark an episode done well before its
        // raw progress figure reaches the end, and a Math.min guards the
        // opposite case -- a client reporting more seconds than the
        // episode is actually long.
        watchedSeconds += history.completed
          ? durationSeconds
          : Math.min(history.progressSeconds, durationSeconds);
        if (!lastWatchedAt || history.updatedAt > lastWatchedAt) {
          lastWatchedAt = history.updatedAt;
        }
      }

      const percent =
        totalSeconds > 0
          ? Math.min(100, Math.round((watchedSeconds / totalSeconds) * 100))
          : 0;
      const state: WatchStatusState =
        percent >= 100 ? 'watched' : percent > 0 ? 'partial' : 'none';

      result[movieId] = {
        state,
        percent,
        lastWatchedAt: lastWatchedAt ? lastWatchedAt.toISOString() : null,
      };
    }

    return result;
  }
}
