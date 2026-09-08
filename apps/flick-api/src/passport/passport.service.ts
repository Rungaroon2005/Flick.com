import { Injectable } from '@nestjs/common';
import { Genre, InteractionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { GENRES_INCLUDE } from '../movies/movies.service';

export interface PassportDto {
  completedMoviesCount: number;
  /** Rounded to one decimal place, e.g. 2.5. */
  totalWatchedHours: number;
  topGenre: Genre | null;
  /** ISO 3166-1 alpha-2 code, e.g. "KR" -- no display name, since there is
   *  no Country table to source one from. The client owns the Thai label. */
  topCountry: { code: string; count: number } | null;
  likedMoviesCount: number;
}

/**
 * GET /me/passport (NewPlan Part D, phase 1) -- a read-only rollup over
 * data that already exists (WatchHistory, MovieGenre, Interaction). The
 * design doc explicitly defers everything needing a new subsystem
 * (Movie.originCountry-based country counts, a 1-10 rating average) to a
 * later phase: this endpoint only ever reports what a user has actually
 * done, never anything requiring data nobody has entered yet.
 */
@Injectable()
export class PassportService {
  constructor(private readonly prisma: PrismaService) {}

  async getPassport(userId: string): Promise<PassportDto> {
    const [histories, likedMoviesCount] = await Promise.all([
      this.prisma.watchHistory.findMany({
        where: { userId, episode: { deletedAt: null } },
        select: {
          progressSeconds: true,
          completed: true,
          episode: {
            select: {
              durationMinutes: true,
              season: { select: { movieId: true } },
            },
          },
        },
      }),
      this.prisma.interaction.count({
        where: { userId, type: InteractionType.LIKE },
      }),
    ]);

    let totalWatchedSeconds = 0;
    const watchedSecondsByMovie = new Map<string, number>();
    for (const history of histories) {
      const durationSeconds = history.episode.durationMinutes * 60;
      // Same rule as EngagementService.getWatchStatus: `completed` pins
      // the contribution to the full duration (the 90% threshold can mark
      // an episode done before its raw progress figure reaches the end),
      // and Math.min guards a client reporting more seconds than the
      // episode is actually long.
      const contribution = history.completed
        ? durationSeconds
        : Math.min(history.progressSeconds, durationSeconds);
      totalWatchedSeconds += contribution;
      const movieId = history.episode.season.movieId;
      watchedSecondsByMovie.set(
        movieId,
        (watchedSecondsByMovie.get(movieId) ?? 0) + contribution,
      );
    }

    const movieIds = [...watchedSecondsByMovie.keys()];
    const movies =
      movieIds.length === 0
        ? []
        : await this.prisma.movie.findMany({
            where: { id: { in: movieIds } },
            select: {
              id: true,
              genres: GENRES_INCLUDE,
              originCountry: true,
              seasons: {
                select: {
                  episodes: {
                    // Excludes a takedown episode from the denominator --
                    // nobody can watch it anymore, so it must not silently
                    // cap what "100% complete" means for this movie.
                    where: { deletedAt: null },
                    select: { durationMinutes: true },
                  },
                },
              },
            },
          });

    let completedMoviesCount = 0;
    const genreCounts = new Map<string, { genre: Genre; count: number }>();
    const countryCounts = new Map<string, number>();
    for (const movie of movies) {
      const totalSeconds = movie.seasons
        .flatMap((season) => season.episodes)
        .reduce((sum, episode) => sum + episode.durationMinutes * 60, 0);
      const watchedSeconds = watchedSecondsByMovie.get(movie.id) ?? 0;
      const percent =
        totalSeconds > 0
          ? Math.min(100, Math.round((watchedSeconds / totalSeconds) * 100))
          : 0;
      if (percent >= 100) completedMoviesCount += 1;
      // Only a movie the user has actually engaged with (not just one they
      // happen to share a history row for, e.g. via a data quirk) counts
      // toward "what genre do you watch most."
      if (percent > 0) {
        for (const { genre } of movie.genres) {
          const entry = genreCounts.get(genre.id) ?? { genre, count: 0 };
          entry.count += 1;
          genreCounts.set(genre.id, entry);
        }
        if (movie.originCountry) {
          countryCounts.set(
            movie.originCountry,
            (countryCounts.get(movie.originCountry) ?? 0) + 1,
          );
        }
      }
    }

    const topGenre =
      [...genreCounts.values()].sort(
        (a, b) => b.count - a.count || a.genre.name.localeCompare(b.genre.name),
      )[0]?.genre ?? null;

    const [topCountryCode, topCountryCount] =
      [...countryCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0] ?? [];
    const topCountry = topCountryCode
      ? { code: topCountryCode, count: topCountryCount }
      : null;

    return {
      completedMoviesCount,
      totalWatchedHours: Math.round((totalWatchedSeconds / 3600) * 10) / 10,
      topGenre,
      topCountry,
      likedMoviesCount,
    };
  }
}
