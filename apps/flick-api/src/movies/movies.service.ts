import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ContentStatus, Genre, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateMovieDto } from './dto/create-movie.dto';

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
};

export const GENRES_INCLUDE = { include: { genre: true as const } };

const MOVIE_LIST_INCLUDE = {
  genres: GENRES_INCLUDE,
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
type MovieDto = Omit<MovieWithRelations, 'genres' | 'seasons'> & {
  genres: Genre[];
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
    T extends { genres: { genre: Genre }[]; seasons?: SeasonWithEpisodes[] },
  >(movie: T) {
    const { genres, ...rest } = movie;
    const base = { ...rest, genres: genres.map((g) => g.genre) };
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

  async create(createMovieDto: CreateMovieDto) {
    const { genreSlugs, ...movieData } = createMovieDto;
    await this.cacheManager.del(CACHE_KEY_ALL_MOVIES);
    const movie = await this.prisma.movie.create({
      data: {
        ...movieData,
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
    return this.toDto(movie);
  }

  async findAll(): Promise<MovieDto[]> {
    // 1. Check cache
    const cachedMovies =
      await this.cacheManager.get<MovieDto[]>(CACHE_KEY_ALL_MOVIES);
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
    await this.cacheManager.set(CACHE_KEY_ALL_MOVIES, dtos, CACHE_TTL_MS);

    return dtos;
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
      include: { genres: GENRES_INCLUDE },
    });

    return similarMovies.map((m) => this.toDto(m));
  }
}
