import { Test, TestingModule } from '@nestjs/testing';
import { PassportService } from './passport.service';
import { PrismaService } from '../prisma.service';
import { createPrismaMock } from '../testing/prisma.mock';
import { InteractionType } from '@prisma/client';

const genre = (id: string, name: string, slug: string) => ({ id, name, slug });

describe('PassportService', () => {
  let service: PassportService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.interaction.count.mockResolvedValue(0);
    prisma.watchHistory.findMany.mockResolvedValue([]);
    prisma.movie.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PassportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PassportService>(PassportService);
  });

  it('returns an all-zero passport for a user with no history and no likes', async () => {
    await expect(service.getPassport('u1')).resolves.toEqual({
      completedMoviesCount: 0,
      totalWatchedHours: 0,
      topGenre: null,
      likedMoviesCount: 0,
    });
    // No movies were ever touched, so there's nothing to look up genres for.
    expect(prisma.movie.findMany).not.toHaveBeenCalled();
  });

  it('excludes a deleted episode from the watch-history query entirely', async () => {
    await service.getPassport('u1');
    expect(prisma.watchHistory.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', episode: { deletedAt: null } },
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
    });
  });

  it('counts a movie as completed once its full non-deleted episode duration is covered', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 0,
        completed: true,
        episode: { durationMinutes: 6, season: { movieId: 'm1' } },
      },
      {
        progressSeconds: 0,
        completed: true,
        episode: { durationMinutes: 6, season: { movieId: 'm1' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Drama', 'drama') }],
        seasons: [
          { episodes: [{ durationMinutes: 6 }, { durationMinutes: 6 }] },
        ],
      },
    ]);

    const result = await service.getPassport('u1');
    expect(result.completedMoviesCount).toBe(1);
    // 720s watched = 0.2h exactly, chosen to avoid a rounding boundary.
    expect(result.totalWatchedHours).toBe(0.2);
  });

  it('does not count a partially watched movie as completed, but still banks its watched seconds', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 0,
        completed: true,
        episode: { durationMinutes: 6, season: { movieId: 'm1' } },
      },
      {
        progressSeconds: 360,
        completed: false,
        episode: { durationMinutes: 20, season: { movieId: 'm1' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Drama', 'drama') }],
        seasons: [
          { episodes: [{ durationMinutes: 6 }, { durationMinutes: 20 }] },
        ],
      },
    ]);

    const result = await service.getPassport('u1');
    // 360s (completed 6-min episode) + 360s (partial progress into the
    // 20-min episode) = 720s watched against a 1560s (26-min) movie --
    // 46%, nowhere near the 100% completion threshold.
    expect(result.completedMoviesCount).toBe(0);
    expect(result.totalWatchedHours).toBe(0.2);
  });

  it("does not let a deleted episode's duration inflate a movie's completion denominator", async () => {
    // Only the non-deleted 10-minute episode is fetched by movie.findMany
    // (its own query filters deletedAt: null on episodes), so watching it
    // in full is 100%, not 50% against a since-deleted second episode.
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 0,
        completed: true,
        episode: { durationMinutes: 10, season: { movieId: 'm1' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Drama', 'drama') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
    ]);

    const result = await service.getPassport('u1');
    expect(result.completedMoviesCount).toBe(1);
  });

  it('sums watched seconds across multiple movies and rounds hours to one decimal place', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 0,
        completed: true,
        episode: { durationMinutes: 30, season: { movieId: 'm1' } },
      },
      {
        progressSeconds: 1350,
        completed: false,
        episode: { durationMinutes: 30, season: { movieId: 'm2' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [],
        seasons: [{ episodes: [{ durationMinutes: 30 }] }],
      },
      {
        id: 'm2',
        genres: [],
        seasons: [{ episodes: [{ durationMinutes: 30 }] }],
      },
    ]);

    // 1800s + 1350s = 3150s = 0.875h -> rounds to 0.9
    const result = await service.getPassport('u1');
    expect(result.totalWatchedHours).toBe(0.9);
  });

  it('picks the genre spanning the most engaged movies', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 300,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm1' } },
      },
      {
        progressSeconds: 300,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm2' } },
      },
      {
        progressSeconds: 300,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm3' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Action', 'action') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
      {
        id: 'm2',
        genres: [{ genre: genre('g1', 'Action', 'action') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
      {
        id: 'm3',
        genres: [{ genre: genre('g2', 'Drama', 'drama') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
    ]);

    const result = await service.getPassport('u1');
    expect(result.topGenre).toEqual(genre('g1', 'Action', 'action'));
  });

  it('breaks a genre-count tie alphabetically by name, deterministically', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 300,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm1' } },
      },
      {
        progressSeconds: 300,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm2' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Zeta', 'zeta') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
      {
        id: 'm2',
        genres: [{ genre: genre('g2', 'Alpha', 'alpha') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
    ]);

    const result = await service.getPassport('u1');
    expect(result.topGenre).toEqual(genre('g2', 'Alpha', 'alpha'));
  });

  it('ignores a touched movie with zero actual engagement when tallying the top genre', async () => {
    prisma.watchHistory.findMany.mockResolvedValue([
      {
        progressSeconds: 0,
        completed: false,
        episode: { durationMinutes: 10, season: { movieId: 'm1' } },
      },
    ]);
    prisma.movie.findMany.mockResolvedValue([
      {
        id: 'm1',
        genres: [{ genre: genre('g1', 'Drama', 'drama') }],
        seasons: [{ episodes: [{ durationMinutes: 10 }] }],
      },
    ]);

    const result = await service.getPassport('u1');
    expect(result.topGenre).toBeNull();
  });

  it('counts likes independently of watch history', async () => {
    prisma.interaction.count.mockResolvedValue(5);

    const result = await service.getPassport('u1');
    expect(result.likedMoviesCount).toBe(5);
    expect(prisma.interaction.count).toHaveBeenCalledWith({
      where: { userId: 'u1', type: InteractionType.LIKE },
    });
  });
});
