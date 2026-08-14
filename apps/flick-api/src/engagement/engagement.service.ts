import { ForbiddenException, Injectable } from '@nestjs/common';
import { Genre, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlaybackService } from '../playback/playback.service';
import { GENRES_INCLUDE } from '../movies/movies.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const COMPLETION_THRESHOLD = 0.9;
const CONTINUE_WATCHING_LIMIT = 10;

const DOWNLOAD_INCLUDE = {
  episode: {
    include: {
      season: {
        include: { movie: { include: { genres: GENRES_INCLUDE } } },
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
function flattenMovieGenres<T extends { genres: { genre: Genre }[] }>(
  movie: T,
) {
  const { genres, ...rest } = movie;
  return { ...rest, genres: genres.map((g) => g.genre) };
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
      include: { movie: { include: { genres: GENRES_INCLUDE } } },
    });
    return bookmarks.map((bookmark) => flattenMovieGenres(bookmark.movie));
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
            season: {
              include: { movie: { include: { genres: GENRES_INCLUDE } } },
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
    // otherwise downloads become a side door around coin/subscription
    // gating.
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
}
