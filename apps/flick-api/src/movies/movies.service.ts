import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { isISO31661Alpha2 } from 'class-validator';
import { ContentStatus, Genre, Mood, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';

const CACHE_KEY_ALL_MOVIES = 'movies:all';
const CACHE_TTL_MS = 300_000; // 5 minutes
const SIMILAR_MOVIES_LIMIT = 10;

const PUBLISHED_FILTER = {
  status: ContentStatus.PUBLISHED,
  deletedAt: null,
} as const;

const EPISODES_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { episodeNumber: 'asc' as const },
  // Timing metadata, not the video itself -- rides in this same cached
  // payload rather than needing its own authenticated endpoint (Tier 1 in
  // the design doc's cache invariant). toDto needs no change to pass this
  // through: it spreads the rest of the episode after destructuring out
  // videoUrl, so a new included relation flows through automatically.
  include: { sceneMarkers: true },
};

export const GENRES_INCLUDE = { include: { genre: true as const } };
// Mood is content-level metadata, identical for every viewer -- same Tier
// 1 reasoning as genres and scene markers -- so it rides in this same
// cached payload rather than needing its own endpoint.
export const MOODS_INCLUDE = { include: { mood: true as const } };

const MOVIE_LIST_INCLUDE = {
  genres: GENRES_INCLUDE,
  moods: MOODS_INCLUDE,
  seasons: { include: { episodes: EPISODES_INCLUDE } },
} satisfies Prisma.MovieInclude;

type MovieWithRelations = Prisma.MovieGetPayload<{
  include: typeof MOVIE_LIST_INCLUDE;
}>;
type SeasonWithEpisodes = MovieWithRelations['seasons'][number];
type EpisodeWithoutVideoUrl = Omit<
  SeasonWithEpisodes['episodes'][number],
  'videoUrl'
>;
export type MovieDto = Omit<
  MovieWithRelations,
  'genres' | 'moods' | 'seasons'
> & {
  genres: Genre[];
  moods: Mood[];
  seasons: (Omit<SeasonWithEpisodes, 'episodes'> & {
    episodes: EpisodeWithoutVideoUrl[];
  })[];
};

@Injectable()
export class MoviesService {
  private readonly logger = new Logger(MoviesService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private logCacheFailure(operation: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `Movie cache ${operation} failed; continuing without cache: ${message}`,
    );
  }

  /**
   * Public so other modules that mutate content reachable through the
   * cached movie payload -- SceneMarkersService, when an admin edits a
   * marker -- can invalidate it too, through the exact same degrade-not-fail
   * treatment `create()` uses below, rather than duplicating it.
   */
  async invalidateCache(): Promise<void> {
    try {
      await this.cacheManager.del(CACHE_KEY_ALL_MOVIES);
    } catch (err) {
      this.logCacheFailure('invalidation', err);
    }
  }

  // Flattens the MovieGenre join-table shape (`{ genres: [{ genre: {...} }] }`)
  // into the wire shape the frontend expects (`{ genres: Genre[] }`), AND
  // strips `videoUrl` off every nested episode. `videoUrl` is the one piece
  // of data that actually lets someone watch a video; it must be reachable
  // ONLY through GET /playback/:episodeId/authorize (Task 2.5) — never via
  // the movie/episode list endpoints. The key is deleted entirely (not set
  // to `null`) so its mere presence in the JSON can't leak information once
  // real videoUrls exist (the current all-null seed data makes a `null`
  // check alone insufficient to catch this). Applied to every endpoint that
  // returns a movie, via `findAll`/`findOne`/`findSimilar`/`create` all
  // routing through this one method.
  private toDto<
    T extends {
      genres: { genre: Genre }[];
      // Optional, not required like genres: real Prisma queries (via
      // MOVIE_LIST_INCLUDE) always provide this, but this method is also
      // exercised by many pre-existing unit test fixtures written before
      // moods existed. Defaulting to [] here keeps those passing without
      // rewriting fixtures that have nothing to do with this feature,
      // while real data is never actually missing the field.
      moods?: { mood: Mood }[];
      seasons?: SeasonWithEpisodes[];
    },
  >(movie: T) {
    const { genres, moods, ...rest } = movie;
    const base = {
      ...rest,
      genres: genres.map((g) => g.genre),
      moods: (moods ?? []).map((m) => m.mood),
    };
    if (!Array.isArray(base.seasons)) {
      return base;
    }
    return {
      ...base,
      seasons: base.seasons.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { videoUrl: _videoUrl, ...episodeRest } = episode;
          return episodeRest;
        }),
      })),
    };
  }

  // ValidationPipe (registered in main.ts's bootstrap) already rejects a
  // malformed code in real requests via CreateMovieDto/UpdateMovieDto's
  // @IsISO31661Alpha2() decorator. This is a second, explicit check for
  // any caller that reaches the service directly -- including the e2e
  // suite, which builds Nest's testing module straight from AppModule and
  // never runs main.ts's bootstrap(). Normalizes to uppercase so the
  // stored value always matches the case the frontend's country-label map
  // keys off.
  private normalizeOriginCountry(
    value: string | undefined,
  ): string | undefined {
    if (value === undefined) return undefined;
    if (!isISO31661Alpha2(value)) {
      throw new BadRequestException(
        'originCountry must be a valid ISO 3166-1 alpha-2 code',
      );
    }
    return value.toUpperCase();
  }

  async create(createMovieDto: CreateMovieDto) {
    const { genreSlugs, ...movieData } = createMovieDto;
    const movie = await this.prisma.movie.create({
      data: {
        ...movieData,
        originCountry: this.normalizeOriginCountry(movieData.originCountry),
        genres: {
          create: genreSlugs.map((slug) => ({
            genre: {
              connectOrCreate: {
                where: { slug },
                create: { slug, name: slug },
              },
            },
          })),
        },
      },
      include: { genres: GENRES_INCLUDE },
    });
    await this.invalidateCache();
    return this.toDto(movie);
  }

  async update(id: string, updateMovieDto: UpdateMovieDto) {
    const originCountry = this.normalizeOriginCountry(
      updateMovieDto.originCountry,
    );
    try {
      const movie = await this.prisma.movie.update({
        where: { id },
        data: { originCountry },
        include: { genres: GENRES_INCLUDE },
      });
      await this.invalidateCache();
      return this.toDto(movie);
    } catch (err) {
      // P2025: prisma.update()'s own "record to update not found" error --
      // caught explicitly rather than left to the global PrismaExceptionFilter,
      // since that filter is registered only in main.ts's bootstrap() and
      // the e2e suite builds Nest's testing module straight from AppModule.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Movie ${id} not found`);
      }
      throw err;
    }
  }

  async findAll(q?: string): Promise<MovieDto[]> {
    // A query param takes the search path below, uncached: caching one slot
    // per distinct search term isn't worth the memory, and this endpoint
    // has never needed sub-request latency the way the full catalogue does.
    if (q !== undefined) {
      return this.searchMovies(q);
    }

    // 1. Check cache
    let cachedMovies: MovieDto[] | undefined;
    try {
      cachedMovies =
        await this.cacheManager.get<MovieDto[]>(CACHE_KEY_ALL_MOVIES);
    } catch (err) {
      this.logCacheFailure('read', err);
    }
    if (cachedMovies) {
      this.logger.debug('Returning movies from cache');
      return cachedMovies;
    }

    this.logger.debug('Cache miss — querying PostgreSQL');
    // 2. Cache Miss: Query Postgres
    const movies = await this.prisma.movie.findMany({
      where: PUBLISHED_FILTER,
      orderBy: { createdAt: 'desc' }, // uses @@index([status, createdAt])
      include: MOVIE_LIST_INCLUDE,
    });

    const dtos = movies.map((movie) => this.toDto(movie));

    // 3. Store in cache for future requests
    try {
      await this.cacheManager.set(CACHE_KEY_ALL_MOVIES, dtos, CACHE_TTL_MS);
    } catch (err) {
      this.logCacheFailure('write', err);
    }

    return dtos;
  }

  // Reuses toDto — the same videoUrl-stripping mapping every other movie
  // endpoint goes through, never a second one that could drift out of sync.
  private async searchMovies(q: string): Promise<MovieDto[]> {
    const term = q.trim();
    const where = term
      ? {
          ...PUBLISHED_FILTER,
          OR: [
            { title: { contains: term, mode: 'insensitive' as const } },
            {
              genres: {
                some: {
                  genre: {
                    name: { contains: term, mode: 'insensitive' as const },
                  },
                },
              },
            },
          ],
        }
      : undefined;

    const movies = await this.prisma.movie.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: MOVIE_LIST_INCLUDE,
    });

    return (movies ?? []).map((movie) => this.toDto(movie));
  }

  async findOne(id: string) {
    const movie = await this.prisma.movie.findFirst({
      where: { id, ...PUBLISHED_FILTER },
      include: MOVIE_LIST_INCLUDE,
    });

    if (!movie) {
      throw new NotFoundException(`Movie ${id} not found`);
    }

    return this.toDto(movie);
  }

  async findSimilar(id: string) {
    const movie = await this.prisma.movie.findFirst({
      where: { id, ...PUBLISHED_FILTER },
      include: { genres: { select: { genreId: true } } },
    });

    if (!movie) {
      throw new NotFoundException(`Movie ${id} not found`);
    }

    const genreIds = movie.genres.map((g) => g.genreId);
    if (genreIds.length === 0) {
      return [];
    }

    const similarMovies = await this.prisma.movie.findMany({
      where: {
        ...PUBLISHED_FILTER,
        id: { not: id },
        genres: { some: { genreId: { in: genreIds } } },
      },
      orderBy: { createdAt: 'desc' },
      take: SIMILAR_MOVIES_LIMIT,
      include: { genres: GENRES_INCLUDE, moods: MOODS_INCLUDE },
    });

    return similarMovies.map((m) => this.toDto(m));
  }
}
