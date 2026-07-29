import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma.service';
import { CreateMovieDto } from './dto/create-movie.dto';

const CACHE_KEY_ALL_MOVIES = 'movies:all';
const CACHE_TTL_MS = 300_000; // 5 minutes

@Injectable()
export class MoviesService {
  private readonly logger = new Logger(MoviesService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  async create(createMovieDto: CreateMovieDto) {
    await this.cacheManager.del(CACHE_KEY_ALL_MOVIES);
    return this.prisma.movie.create({
      data: createMovieDto,
    });
  }

  async findAll() {
    // 1. Check Redis Cache
    const cachedMovies = await this.cacheManager.get(CACHE_KEY_ALL_MOVIES);
    if (cachedMovies) {
      this.logger.debug('Returning movies from Redis cache');
      return cachedMovies;
    }

    this.logger.debug('Cache miss — querying PostgreSQL');
    // 2. Cache Miss: Query Postgres
    const movies = await this.prisma.movie.findMany({
      include: {
        seasons: {
          include: {
            episodes: true,
          },
        },
      },
    });

    // 3. Store in Redis for future requests
    await this.cacheManager.set(CACHE_KEY_ALL_MOVIES, movies, CACHE_TTL_MS);

    return movies;
  }

  async findOne(id: string) {
    return this.prisma.movie.findUnique({
      where: { id },
      include: {
        seasons: {
          include: {
            episodes: true,
          },
        },
      },
    });
  }
}

